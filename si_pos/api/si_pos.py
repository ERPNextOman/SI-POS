import re
from typing import Any

import frappe
from frappe import _
from frappe.utils import flt, nowdate


DEFAULT_SEARCH_FIELDS = [
    "item_code",
    "item_name",
    "description",
    "custom_part_no",
    "custom_ref_part_no",
    "custom_supplier_part_number",
    "custom_genafm",
    "custom_vehicle",
]

COMMON_CASH_NAMES = ["Cash", "Cash Payment"]
COMMON_CARD_NAMES = ["Card", "Credit Card", "Debit Card", "Bank Card"]
COMMON_BANK_NAMES = ["Bank Transfer", "Bank", "Online Transfer", "Wire Transfer"]

VAT_RATE = 5.0
VAT_DESCRIPTION = "VAT 5% Included"


def _parse_json(value: Any) -> Any:
    if isinstance(value, str):
        return frappe.parse_json(value)
    return value


def _clean_text(value: Any) -> str:
    return (str(value or "")).strip()


def _safe_int(value: Any, default: int = 20, minimum: int = 1, maximum: int = 100) -> int:
    try:
        value = int(value)
    except Exception:
        value = default
    return max(minimum, min(maximum, value))


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value or 0)
    except Exception:
        return default


def _item_search_fields() -> list[str]:
    meta = frappe.get_meta("Item")
    existing = {d.fieldname for d in meta.fields}
    return [
        field
        for field in DEFAULT_SEARCH_FIELDS
        if field in existing or field in {"item_code", "item_name", "description"}
    ]


def _tokenize_search_text(txt: str) -> list[str]:
    txt = _clean_text(txt)
    if not txt:
        return []
    tokens = [t.strip() for t in re.split(r"\s+", txt) if t.strip()]
    return tokens[:6]


def _get_default_company(company: str | None = None) -> str | None:
    return (
        _clean_text(company)
        or frappe.defaults.get_user_default("Company")
        or frappe.defaults.get_global_default("company")
    )


def _get_default_price_list(price_list: str | None = None) -> str | None:
    price_list = _clean_text(price_list)
    if price_list:
        return price_list

    selling_settings = frappe.get_single("Selling Settings")
    return selling_settings.selling_price_list or frappe.db.get_single_value(
        "Selling Settings", "selling_price_list"
    )


def _get_item_price(item_code: str, price_list: str | None = None, uom: str | None = None) -> float:
    filters = {"item_code": item_code, "selling": 1}

    if price_list:
        filters["price_list"] = price_list

    if uom:
        price = frappe.db.get_value("Item Price", {**filters, "uom": uom}, "price_list_rate")
        if price is not None:
            return float(price)

    price = frappe.db.get_value(
        "Item Price",
        filters,
        "price_list_rate",
        order_by="valid_from desc, modified desc",
    )
    if price is not None:
        return float(price)

    price = frappe.db.get_value(
        "Item Price",
        {"item_code": item_code, "selling": 1, "price_list": "Standard Selling"},
        "price_list_rate",
        order_by="valid_from desc, modified desc",
    )
    return float(price or 0)


def _get_stock_qty(item_code: str, warehouse: str | None = None) -> float | None:
    warehouse = _clean_text(warehouse)
    if not warehouse:
        return None

    qty = frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty")
    return float(qty or 0)


def _validate_header(customer: str, company: str | None) -> tuple[str, str]:
    customer = _clean_text(customer)
    if not customer:
        frappe.throw(_("Customer is required."))

    if not frappe.db.exists("Customer", customer):
        frappe.throw(_("Customer {0} does not exist.").format(customer))

    company = _get_default_company(company)
    if not company:
        frappe.throw(_("Company is required. Please select a company."))

    if not frappe.db.exists("Company", company):
        frappe.throw(_("Company {0} does not exist.").format(company))

    return customer, company


def _get_inclusive_vat_template_rows(company: str) -> list[dict[str, Any]]:
    rows = frappe.db.sql(
        """
        SELECT
            stct.name AS template,
            stc.charge_type,
            stc.account_head,
            stc.description,
            stc.rate,
            stc.included_in_print_rate,
            stc.cost_center
        FROM `tabSales Taxes and Charges Template` stct
        INNER JOIN `tabSales Taxes and Charges` stc ON stc.parent = stct.name
        WHERE ifnull(stct.disabled, 0) = 0
          AND (stct.company = %(company)s OR ifnull(stct.company, '') = '')
          AND stc.charge_type = 'On Net Total'
          AND ifnull(stc.included_in_print_rate, 0) = 1
          AND ABS(ifnull(stc.rate, 0) - %(vat_rate)s) < 0.0001
        ORDER BY ifnull(stct.is_default, 0) DESC, stct.modified DESC, stc.idx ASC
        LIMIT 5
        """,
        {"company": company, "vat_rate": VAT_RATE},
        as_dict=True,
    )

    if not rows:
        return []

    template = rows[0].template
    return [row for row in rows if row.template == template]


def _get_default_vat_account(company: str) -> str:
    account = frappe.db.sql(
        """
        SELECT name
        FROM `tabAccount`
        WHERE company = %(company)s
          AND is_group = 0
          AND (
                LOWER(account_name) LIKE '%%output%%vat%%'
             OR LOWER(name) LIKE '%%output%%vat%%'
             OR LOWER(account_name) LIKE '%%vat%%output%%'
             OR LOWER(name) LIKE '%%vat%%output%%'
             OR LOWER(account_name) LIKE '%%sales%%tax%%'
             OR LOWER(name) LIKE '%%sales%%tax%%'
             OR LOWER(account_name) LIKE '%%vat%%'
             OR LOWER(name) LIKE '%%vat%%'
             OR account_type = 'Tax'
          )
        ORDER BY
            CASE
                WHEN LOWER(account_name) LIKE '%%output%%vat%%' OR LOWER(name) LIKE '%%output%%vat%%' THEN 0
                WHEN LOWER(account_name) LIKE '%%vat%%output%%' OR LOWER(name) LIKE '%%vat%%output%%' THEN 1
                WHEN LOWER(account_name) LIKE '%%sales%%tax%%' OR LOWER(name) LIKE '%%sales%%tax%%' THEN 2
                WHEN LOWER(account_name) LIKE '%%vat%%' OR LOWER(name) LIKE '%%vat%%' THEN 3
                ELSE 4
            END,
            name ASC
        LIMIT 1
        """,
        {"company": company},
        as_dict=True,
    )

    if account:
        return account[0].name

    frappe.throw(
        _(
            "Could not find a VAT account for company {0}. Please create an Output VAT / Sales Tax account or an inclusive 5% Sales Taxes and Charges Template."
        ).format(company)
    )


def _apply_inclusive_vat(invoice, company: str) -> None:
    """Add fixed 5% inclusive VAT.

    Item rates in SI POS are treated as VAT-inclusive. Example: rate 100 means
    customer pays 100 and VAT is extracted from that amount.
    """
    invoice.set("taxes", [])

    template_rows = _get_inclusive_vat_template_rows(company)
    if template_rows:
        invoice.taxes_and_charges = template_rows[0].template
        for row in template_rows:
            invoice.append(
                "taxes",
                {
                    "charge_type": row.charge_type,
                    "account_head": row.account_head,
                    "description": row.description or VAT_DESCRIPTION,
                    "rate": row.rate or VAT_RATE,
                    "included_in_print_rate": 1,
                    "cost_center": row.cost_center,
                },
            )
        return

    vat_account = _get_default_vat_account(company)
    invoice.append(
        "taxes",
        {
            "charge_type": "On Net Total",
            "account_head": vat_account,
            "description": VAT_DESCRIPTION,
            "rate": VAT_RATE,
            "included_in_print_rate": 1,
        },
    )


def _apply_discount(invoice, discount_percentage: Any = 0, discount_amount: Any = 0) -> None:
    discount_percentage = _safe_float(discount_percentage, 0)
    discount_amount = _safe_float(discount_amount, 0)

    if discount_amount < 0 or discount_percentage < 0:
        frappe.throw(_("Discount cannot be negative."))

    if discount_amount > 0:
        invoice.apply_discount_on = "Grand Total"
        invoice.discount_amount = discount_amount
        invoice.additional_discount_percentage = 0
    elif discount_percentage > 0:
        invoice.apply_discount_on = "Grand Total"
        invoice.additional_discount_percentage = discount_percentage
        invoice.discount_amount = 0


def _build_sales_invoice(
    customer: str,
    items: str | list[dict[str, Any]],
    company: str | None = None,
    price_list: str | None = None,
    set_warehouse: str | None = None,
    discount_percentage: Any = 0,
    discount_amount: Any = 0,
):
    customer, company = _validate_header(customer, company)
    price_list = _get_default_price_list(price_list)
    cart_items = _parse_json(items) or []

    if not isinstance(cart_items, list) or not cart_items:
        frappe.throw(_("Please add at least one item to the cart."))

    invoice = frappe.new_doc("Sales Invoice")
    invoice.company = company
    invoice.customer = customer

    if price_list:
        invoice.selling_price_list = price_list

    if _clean_text(set_warehouse):
        invoice.set_warehouse = _clean_text(set_warehouse)

    for row in cart_items:
        item_code = _clean_text(row.get("item_code"))
        qty = _safe_float(row.get("qty"), default=0)
        rate = _safe_float(row.get("rate"), default=0)
        uom = _clean_text(row.get("uom"))

        if not item_code:
            frappe.throw(_("One cart row is missing Item Code."))
        if qty <= 0:
            frappe.throw(_("Qty must be greater than zero for item {0}.").format(item_code))
        if rate < 0:
            frappe.throw(_("Rate cannot be negative for item {0}.").format(item_code))
        if not frappe.db.exists("Item", item_code):
            frappe.throw(_("Item {0} does not exist.").format(item_code))

        item_row = {"item_code": item_code, "qty": qty, "rate": rate}
        if uom:
            item_row["uom"] = uom
        invoice.append("items", item_row)

    _apply_inclusive_vat(invoice, company)
    _apply_discount(invoice, discount_percentage=discount_percentage, discount_amount=discount_amount)
    return invoice


def _calculate_invoice(invoice) -> None:
    for method_name in ("set_missing_values", "calculate_taxes_and_totals"):
        if hasattr(invoice, method_name):
            invoice.run_method(method_name)


def _invoice_total(invoice) -> float:
    total = invoice.get("rounded_total") or invoice.get("grand_total") or 0
    return flt(total, invoice.precision("grand_total") or 3)


def _tax_rows(invoice) -> list[dict[str, Any]]:
    rows = []
    for tax in invoice.get("taxes", []):
        rows.append(
            {
                "description": tax.description,
                "account_head": tax.account_head,
                "rate": tax.rate,
                "tax_amount": tax.tax_amount,
                "total": tax.total,
                "included_in_print_rate": tax.included_in_print_rate,
            }
        )
    return rows


def _preview_response(invoice) -> dict[str, Any]:
    precision = invoice.precision("grand_total") or 3
    rounded_total = invoice.get("rounded_total") or invoice.get("grand_total") or 0
    grand_total = invoice.get("grand_total") or 0
    return {
        "currency": invoice.currency,
        "total_qty": invoice.total_qty,
        "net_total": flt(invoice.net_total, precision),
        "total": flt(invoice.total, precision),
        "discount_amount": flt(invoice.discount_amount, precision),
        "additional_discount_percentage": flt(invoice.additional_discount_percentage, 3),
        "total_taxes_and_charges": flt(invoice.total_taxes_and_charges, precision),
        "grand_total": flt(grand_total, precision),
        "rounded_total": flt(rounded_total, precision),
        "rounding_adjustment": flt(rounded_total - grand_total, precision),
        "payable_total": flt(rounded_total, precision),
        "taxes": _tax_rows(invoice),
    }


def _invoice_response(invoice, payment_entries: list[str] | None = None) -> dict[str, Any]:
    return {
        "name": invoice.name,
        "docstatus": invoice.docstatus,
        "grand_total": invoice.grand_total,
        "rounded_total": invoice.rounded_total,
        "outstanding_amount": invoice.outstanding_amount,
        "currency": invoice.currency,
        "payment_entries": payment_entries or [],
        "route": f"/app/sales-invoice/{invoice.name}",
        "print_route": f"/app/print/Sales%20Invoice/{invoice.name}",
    }


def _get_mode_account(mode_of_payment: str, company: str) -> str:
    mode_of_payment = _clean_text(mode_of_payment)
    if not mode_of_payment:
        frappe.throw(_("Mode of Payment is required."))

    if not frappe.db.exists("Mode of Payment", mode_of_payment):
        frappe.throw(_("Mode of Payment {0} does not exist.").format(mode_of_payment))

    account = frappe.db.get_value(
        "Mode of Payment Account",
        {"parent": mode_of_payment, "company": company},
        "default_account",
    )

    if not account:
        account = frappe.db.get_value(
            "Mode of Payment Account",
            {"parent": mode_of_payment},
            "default_account",
        )

    if not account:
        frappe.throw(
            _("Please set a default account for Mode of Payment {0} for company {1}.").format(
                mode_of_payment, company
            )
        )

    return account


def _normalise_payments(payments: str | list[dict[str, Any]], company: str) -> list[dict[str, Any]]:
    payments = _parse_json(payments) or []
    if not isinstance(payments, list):
        frappe.throw(_("Payments must be a list."))

    cleaned = []
    for row in payments:
        mode = _clean_text(row.get("mode_of_payment"))
        amount = _safe_float(row.get("amount"), default=0)
        if amount <= 0:
            continue
        if not mode:
            frappe.throw(_("Mode of Payment is required for paid amount {0}.").format(amount))

        cleaned.append(
            {
                "mode_of_payment": mode,
                "amount": amount,
                "account": _get_mode_account(mode, company),
            }
        )

    return cleaned


def _create_payment_entries(invoice, payments: list[dict[str, Any]]) -> list[str]:
    if not frappe.has_permission("Payment Entry", "create"):
        frappe.throw(_("You do not have permission to create Payment Entry."), frappe.PermissionError)

    payment_entries = []
    precision = invoice.precision("grand_total") or 3
    invoice_total = _invoice_total(invoice)

    for row in payments:
        invoice.reload()
        outstanding_amount = flt(invoice.outstanding_amount, precision)
        amount = flt(row["amount"], precision)

        if outstanding_amount <= 0:
            break

        allocated_amount = min(amount, outstanding_amount)

        payment_entry = frappe.new_doc("Payment Entry")
        payment_entry.payment_type = "Receive"
        payment_entry.company = invoice.company
        payment_entry.posting_date = nowdate()
        payment_entry.mode_of_payment = row["mode_of_payment"]
        payment_entry.party_type = "Customer"
        payment_entry.party = invoice.customer
        payment_entry.party_name = invoice.customer_name
        payment_entry.paid_from = invoice.debit_to
        payment_entry.paid_to = row["account"]
        payment_entry.paid_amount = allocated_amount
        payment_entry.received_amount = allocated_amount
        payment_entry.reference_no = f"SI-POS-{invoice.name}"
        payment_entry.reference_date = nowdate()
        payment_entry.remarks = f"SI POS payment for Sales Invoice {invoice.name}"

        payment_entry.append(
            "references",
            {
                "reference_doctype": "Sales Invoice",
                "reference_name": invoice.name,
                "total_amount": invoice_total,
                "outstanding_amount": outstanding_amount,
                "allocated_amount": allocated_amount,
            },
        )

        payment_entry.insert()
        payment_entry.submit()
        payment_entries.append(payment_entry.name)

    invoice.reload()
    return payment_entries


def _pick_mode(modes: list[dict[str, Any]], names: list[str], mode_type: str | None = None) -> str | None:
    lower_names = {name.lower() for name in names}
    for row in modes:
        if row.get("name", "").lower() in lower_names:
            return row.get("name")

    if mode_type:
        for row in modes:
            if (row.get("type") or "").lower() == mode_type.lower():
                return row.get("name")

    return modes[0]["name"] if modes else None


@frappe.whitelist()
def get_defaults() -> dict[str, Any]:
    if not frappe.has_permission("Sales Invoice", "create"):
        frappe.throw(_("You do not have permission to create Sales Invoice."), frappe.PermissionError)

    company = _get_default_company()
    modes = get_payment_modes(company=company) if company else []

    return {
        "company": company,
        "price_list": _get_default_price_list(),
        "currency": frappe.defaults.get_global_default("currency") or "OMR",
        "vat_rate": VAT_RATE,
        "vat_inclusive": 1,
        "payment_modes": modes,
        "cash_mode": _pick_mode(modes, COMMON_CASH_NAMES, "Cash"),
        "card_mode": _pick_mode(modes, COMMON_CARD_NAMES, "Card"),
        "bank_mode": _pick_mode(modes, COMMON_BANK_NAMES, "Bank"),
    }


@frappe.whitelist()
def get_payment_modes(company: str | None = None) -> list[dict[str, Any]]:
    if not frappe.has_permission("Mode of Payment", "read"):
        return []

    company = _get_default_company(company)
    meta = frappe.get_meta("Mode of Payment")
    fields = ["name", "type"]
    filters = {}

    if any(d.fieldname == "enabled" for d in meta.fields):
        filters["enabled"] = 1

    modes = frappe.get_all("Mode of Payment", filters=filters, fields=fields, order_by="name asc")
    result = []

    for mode in modes:
        account = None
        if company:
            account = frappe.db.get_value(
                "Mode of Payment Account",
                {"parent": mode.name, "company": company},
                "default_account",
            )
        if not account:
            account = frappe.db.get_value(
                "Mode of Payment Account", {"parent": mode.name}, "default_account"
            )
        result.append({"name": mode.name, "type": mode.get("type"), "account": account})

    return result


@frappe.whitelist()
def search_items(
    txt: str = "",
    price_list: str | None = None,
    warehouse: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    if not frappe.has_permission("Item", "read"):
        frappe.throw(_("You do not have permission to read Item."), frappe.PermissionError)

    limit = _safe_int(limit, default=20, maximum=50)
    txt = _clean_text(txt)
    tokens = _tokenize_search_text(txt)
    price_list = _get_default_price_list(price_list)

    if not tokens:
        return []

    fields = _item_search_fields()
    params: dict[str, Any] = {"limit": limit}
    where = ["i.disabled = 0", "ifnull(i.is_sales_item, 1) = 1"]

    for idx, token in enumerate(tokens):
        key = f"token_{idx}"
        params[key] = f"%{token}%"
        item_clauses = [f"i.`{field}` LIKE %({key})s" for field in fields]
        item_clauses.append(
            "EXISTS (SELECT 1 FROM `tabItem Barcode` ib WHERE ib.parent = i.name AND ib.barcode LIKE %({})s)".format(
                key
            )
        )
        where.append("(" + " OR ".join(item_clauses) + ")")

    sql = f"""
        SELECT
            i.item_code,
            i.item_name,
            i.stock_uom,
            i.sales_uom,
            i.image,
            i.item_group
        FROM `tabItem` i
        WHERE {' AND '.join(where)}
        ORDER BY
            CASE WHEN i.item_code LIKE %(token_0)s THEN 0 ELSE 1 END,
            i.modified DESC
        LIMIT %(limit)s
    """

    rows = frappe.db.sql(sql, params, as_dict=True)
    result = []

    for row in rows:
        uom = row.sales_uom or row.stock_uom
        rate = _get_item_price(row.item_code, price_list=price_list, uom=uom)
        result.append(
            {
                "item_code": row.item_code,
                "item_name": row.item_name,
                "uom": uom,
                "stock_uom": row.stock_uom,
                "rate": rate,
                "image": row.image,
                "item_group": row.item_group,
                "actual_qty": _get_stock_qty(row.item_code, warehouse=warehouse),
            }
        )

    return result


@frappe.whitelist()
def get_item_details(
    item_code: str,
    price_list: str | None = None,
    warehouse: str | None = None,
) -> dict[str, Any]:
    item_code = _clean_text(item_code)
    if not item_code:
        frappe.throw(_("Item Code is required."))

    if not frappe.has_permission("Item", "read"):
        frappe.throw(_("You do not have permission to read Item."), frappe.PermissionError)

    item = frappe.get_cached_doc("Item", item_code)
    if item.disabled:
        frappe.throw(_("Item {0} is disabled.").format(item_code))

    if item.get("is_sales_item") == 0:
        frappe.throw(_("Item {0} is not marked as a sales item.").format(item_code))

    price_list = _get_default_price_list(price_list)
    uom = item.sales_uom or item.stock_uom
    rate = _get_item_price(item_code, price_list=price_list, uom=uom)

    return {
        "item_code": item.item_code,
        "item_name": item.item_name,
        "uom": uom,
        "stock_uom": item.stock_uom,
        "rate": rate,
        "image": item.image,
        "item_group": item.item_group,
        "actual_qty": _get_stock_qty(item_code, warehouse=warehouse),
    }


@frappe.whitelist()
def preview_sales_invoice(
    customer: str,
    items: str | list[dict[str, Any]],
    company: str | None = None,
    price_list: str | None = None,
    set_warehouse: str | None = None,
    discount_percentage: Any = 0,
    discount_amount: Any = 0,
) -> dict[str, Any]:
    if not frappe.has_permission("Sales Invoice", "create"):
        frappe.throw(_("You do not have permission to create Sales Invoice."), frappe.PermissionError)

    invoice = _build_sales_invoice(
        customer,
        items,
        company,
        price_list,
        set_warehouse,
        discount_percentage=discount_percentage,
        discount_amount=discount_amount,
    )
    _calculate_invoice(invoice)
    return _preview_response(invoice)


@frappe.whitelist()
def create_sales_invoice(
    customer: str,
    items: str | list[dict[str, Any]],
    company: str | None = None,
    price_list: str | None = None,
    set_warehouse: str | None = None,
    discount_percentage: Any = 0,
    discount_amount: Any = 0,
) -> dict[str, Any]:
    if not frappe.has_permission("Sales Invoice", "create"):
        frappe.throw(_("You do not have permission to create Sales Invoice."), frappe.PermissionError)

    invoice = _build_sales_invoice(
        customer,
        items,
        company,
        price_list,
        set_warehouse,
        discount_percentage=discount_percentage,
        discount_amount=discount_amount,
    )
    invoice.insert()
    return _invoice_response(invoice)


@frappe.whitelist()
def create_and_submit_sales_invoice(
    customer: str,
    items: str | list[dict[str, Any]],
    company: str | None = None,
    price_list: str | None = None,
    set_warehouse: str | None = None,
    discount_percentage: Any = 0,
    discount_amount: Any = 0,
) -> dict[str, Any]:
    if not frappe.has_permission("Sales Invoice", "create"):
        frappe.throw(_("You do not have permission to create Sales Invoice."), frappe.PermissionError)

    invoice = _build_sales_invoice(
        customer,
        items,
        company,
        price_list,
        set_warehouse,
        discount_percentage=discount_percentage,
        discount_amount=discount_amount,
    )
    invoice.insert()
    invoice.submit()
    return _invoice_response(invoice)


@frappe.whitelist()
def create_paid_sales_invoice(
    customer: str,
    items: str | list[dict[str, Any]],
    payments: str | list[dict[str, Any]],
    company: str | None = None,
    price_list: str | None = None,
    set_warehouse: str | None = None,
    discount_percentage: Any = 0,
    discount_amount: Any = 0,
) -> dict[str, Any]:
    if not frappe.has_permission("Sales Invoice", "create"):
        frappe.throw(_("You do not have permission to create Sales Invoice."), frappe.PermissionError)

    customer, company = _validate_header(customer, company)
    invoice = _build_sales_invoice(
        customer,
        items,
        company,
        price_list,
        set_warehouse,
        discount_percentage=discount_percentage,
        discount_amount=discount_amount,
    )

    _calculate_invoice(invoice)
    target_total = _invoice_total(invoice)
    cleaned_payments = _normalise_payments(payments, company)

    if not cleaned_payments:
        frappe.throw(_("Please enter at least one payment amount."))

    paid_total = flt(sum(flt(row["amount"]) for row in cleaned_payments), invoice.precision("grand_total") or 3)
    tolerance = 0.001

    if abs(paid_total - target_total) > tolerance:
        frappe.throw(
            _("Paid amount {0} must equal invoice total {1}.").format(
                frappe.format_value(paid_total, {"fieldtype": "Currency"}),
                frappe.format_value(target_total, {"fieldtype": "Currency"}),
            )
        )

    invoice.insert()
    invoice.submit()

    payment_entries = _create_payment_entries(invoice, cleaned_payments)
    invoice.reload()

    return _invoice_response(invoice, payment_entries=payment_entries)
