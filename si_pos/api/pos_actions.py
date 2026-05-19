from __future__ import annotations

from collections import defaultdict
from typing import Any

import frappe
from frappe import _
from frappe.utils import flt, getdate, nowdate


def _safe_int(value: Any, default: int = 100, minimum: int = 1, maximum: int = 500) -> int:
    try:
        value = int(value or default)
    except Exception:
        value = default
    return max(minimum, min(maximum, value))


def _is_cash_mode(mode: str | None) -> bool:
    mode = (mode or "").strip().lower()
    return "cash" in mode


def _sum_by_mode(rows: list[dict[str, Any]], mode_field: str, amount_field: str) -> dict[str, float]:
    totals: dict[str, float] = defaultdict(float)
    for row in rows:
        mode = row.get(mode_field) or "Unspecified"
        totals[mode] += flt(row.get(amount_field))
    return dict(totals)


def _get_open_cash_shift(company: str | None, warehouse: str | None, cashier: str):
    if not company or not warehouse or not frappe.db.exists("DocType", "SI POS Cash Shift"):
        return None
    name = frappe.db.get_value(
        "SI POS Cash Shift",
        {
            "docstatus": ["<", 2],
            "status": "Open",
            "company": company,
            "warehouse": warehouse,
            "cashier": cashier,
        },
        "name",
    )
    if not name:
        return None
    doc = frappe.get_doc("SI POS Cash Shift", name)
    return {
        "name": doc.name,
        "opening_amount": flt(doc.opening_amount),
        "opening_datetime": doc.opening_datetime,
        "status": doc.status,
    }


@frappe.whitelist()
def quick_create_customer(
    customer_name: str,
    mobile_no: str | None = None,
    email_id: str | None = None,
    customer_group: str | None = None,
    territory: str | None = None,
) -> dict[str, Any]:
    """Create a simple Customer from the SI POS screen."""
    if not frappe.has_permission("Customer", "create"):
        frappe.throw(_("You do not have permission to create Customer."), frappe.PermissionError)

    customer_name = (customer_name or "").strip()
    if not customer_name:
        frappe.throw(_("Customer Name is required."))

    customer_group = customer_group or frappe.db.get_single_value("Selling Settings", "customer_group")
    territory = territory or frappe.db.get_single_value("Selling Settings", "territory")

    if not customer_group:
        customer_group = frappe.db.get_value("Customer Group", {"is_group": 0}, "name")
    if not territory:
        territory = frappe.db.get_value("Territory", {"is_group": 0}, "name")

    customer = frappe.new_doc("Customer")
    customer.customer_name = customer_name
    customer.customer_type = "Individual"
    if customer_group:
        customer.customer_group = customer_group
    if territory:
        customer.territory = territory
    if mobile_no and hasattr(customer, "mobile_no"):
        customer.mobile_no = mobile_no
    if email_id and hasattr(customer, "email_id"):
        customer.email_id = email_id

    customer.insert()

    return {
        "name": customer.name,
        "customer_name": customer.customer_name,
        "mobile_no": mobile_no,
        "email_id": email_id,
    }


@frappe.whitelist()
def get_cashier_daily_closing(
    posting_date: str | None = None,
    company: str | None = None,
    warehouse: str | None = None,
    cashier: str | None = None,
) -> dict[str, Any]:
    """Return a cashier-wise same-day closing summary for SI POS."""
    if not frappe.has_permission("Sales Invoice", "read"):
        frappe.throw(_("You do not have permission to read Sales Invoice."), frappe.PermissionError)

    posting_date = getdate(posting_date or nowdate())
    current_user = frappe.session.user
    cashier = cashier or current_user

    if cashier != current_user and "System Manager" not in frappe.get_roles(current_user):
        frappe.throw(_("You can only view your own daily closing."), frappe.PermissionError)

    filters = {
        "docstatus": 1,
        "posting_date": posting_date,
        "owner": cashier,
    }
    if company:
        filters["company"] = company

    invoices = frappe.get_all(
        "Sales Invoice",
        filters=filters,
        fields=[
            "name",
            "customer",
            "customer_name",
            "grand_total",
            "rounded_total",
            "outstanding_amount",
            "posting_time",
            "is_return",
            "discount_amount",
        ],
        order_by="creation asc",
        limit_page_length=1000,
    )

    invoice_names = [row.name for row in invoices]
    mode_totals: dict[str, float] = defaultdict(float)
    payment_entries = []

    if invoice_names:
        payment_entries = frappe.db.sql(
            """
            SELECT
                pe.name,
                pe.mode_of_payment,
                pe.paid_amount,
                per.reference_name
            FROM `tabPayment Entry Reference` per
            INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
            WHERE pe.docstatus = 1
              AND per.reference_doctype = 'Sales Invoice'
              AND per.reference_name IN %(invoice_names)s
            ORDER BY pe.creation ASC
            """,
            {"invoice_names": tuple(invoice_names)},
            as_dict=True,
        )

        for pe in payment_entries:
            mode_totals[pe.mode_of_payment or "Unspecified"] += flt(pe.paid_amount)

    invoice_total = 0.0
    sales_net_total = 0.0
    sales_total = 0.0
    return_total = 0.0
    discount_total = 0.0
    outstanding_total = 0.0

    for row in invoices:
        value = flt(row.rounded_total or row.grand_total)
        discount = flt(row.discount_amount)
        invoice_total += value
        if row.get("is_return"):
            return_total += abs(value)
        else:
            sales_net_total += value
            discount_total += discount
            sales_total += value + discount
        outstanding_total += flt(row.outstanding_amount)

    paid_total = sum(mode_totals.values())
    cash_sales_total = sum(amount for mode, amount in mode_totals.items() if _is_cash_mode(mode))
    card_sales_total = paid_total - cash_sales_total

    advance_filters = {
        "docstatus": 1,
        "posting_date": posting_date,
        "owner": cashier,
        "payment_type": "Receive",
        "party_type": "Customer",
    }
    if company:
        advance_filters["company"] = company

    all_receive_entries = frappe.get_all(
        "Payment Entry",
        filters=advance_filters,
        fields=["name", "party", "mode_of_payment", "paid_amount", "remarks", "creation"],
        order_by="creation asc",
        limit_page_length=1000,
    )

    invoice_payment_names = {row.name for row in payment_entries}
    advances = [row for row in all_receive_entries if row.name not in invoice_payment_names]
    advance_mode_totals = _sum_by_mode(advances, "mode_of_payment", "paid_amount")
    advance_total = sum(advance_mode_totals.values())
    cash_advance_total = sum(amount for mode, amount in advance_mode_totals.items() if _is_cash_mode(mode))

    expense_filters = {
        "docstatus": 1,
        "posting_date": posting_date,
        "cashier": cashier,
    }
    if company:
        expense_filters["company"] = company
    if warehouse:
        expense_filters["warehouse"] = warehouse

    expenses = frappe.get_all(
        "SI POS Daily Expense",
        filters=expense_filters,
        fields=["name", "purpose", "amount", "mode_of_payment", "journal_entry", "creation"],
        order_by="creation asc",
        limit_page_length=1000,
    ) if frappe.db.exists("DocType", "SI POS Daily Expense") else []

    expense_mode_totals = _sum_by_mode(expenses, "mode_of_payment", "amount")
    expense_total = sum(expense_mode_totals.values())
    cash_expense_total = sum(amount for mode, amount in expense_mode_totals.items() if _is_cash_mode(mode))

    deposit_filters = {
        "docstatus": 1,
        "posting_date": posting_date,
        "cashier": cashier,
    }
    if company:
        deposit_filters["company"] = company
    if warehouse:
        deposit_filters["warehouse"] = warehouse

    deposits = frappe.get_all(
        "SI POS Bank Deposit",
        filters=deposit_filters,
        fields=["name", "bank_name", "amount", "from_mode_of_payment", "journal_entry", "creation"],
        order_by="creation asc",
        limit_page_length=1000,
    ) if frappe.db.exists("DocType", "SI POS Bank Deposit") else []

    deposit_mode_totals = _sum_by_mode(deposits, "from_mode_of_payment", "amount")
    deposit_total = sum(deposit_mode_totals.values())
    cash_deposit_total = sum(amount for mode, amount in deposit_mode_totals.items() if _is_cash_mode(mode))

    shift = _get_open_cash_shift(company, warehouse, cashier)
    opening_balance = flt(shift.get("opening_amount")) if shift else 0.0

    # Section 1 requested formula:
    # opening balance + total sales + total advance received - daily expenses - discount - bank deposit
    available_till_balance = opening_balance + sales_total + advance_total - expense_total - discount_total - deposit_total

    # Section 2 requested formula:
    # opening balance + cash sales
    till_available_balance = opening_balance + cash_sales_total

    expected_cash = cash_sales_total + cash_advance_total - cash_expense_total - cash_deposit_total

    return {
        "posting_date": str(posting_date),
        "company": company,
        "warehouse": warehouse,
        "cashier": cashier,
        "cash_shift": shift,
        "opening_balance": opening_balance,
        "invoice_count": len(invoices),
        "invoice_total": invoice_total,
        "sales_total": sales_total,
        "sales_net_total": sales_net_total,
        "return_total": return_total,
        "discount_total": discount_total,
        "paid_total": paid_total,
        "cash_sales_total": cash_sales_total,
        "card_sales_total": card_sales_total,
        "outstanding_total": outstanding_total,
        "mode_totals": dict(mode_totals),
        "advance_total": advance_total,
        "cash_advance_total": cash_advance_total,
        "advance_mode_totals": advance_mode_totals,
        "expense_total": expense_total,
        "cash_expense_total": cash_expense_total,
        "expense_mode_totals": expense_mode_totals,
        "deposit_total": deposit_total,
        "cash_deposit_total": cash_deposit_total,
        "deposit_mode_totals": deposit_mode_totals,
        "available_till_balance": available_till_balance,
        "till_available_balance": till_available_balance,
        "expected_cash": expected_cash,
        "invoices": invoices,
        "payment_entries": payment_entries,
        "advances": advances,
        "expenses": expenses,
        "deposits": deposits,
    }


@frappe.whitelist()
def get_created_sales_invoices(
    company: str | None = None,
    customer: str | None = None,
    posting_date: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    """Return Sales Invoices created by the current cashier/user."""
    if not frappe.has_permission("Sales Invoice", "read"):
        frappe.throw(_("You do not have permission to read Sales Invoice."), frappe.PermissionError)

    filters: dict[str, Any] = {
        "owner": frappe.session.user,
    }
    if company:
        filters["company"] = company
    if customer:
        filters["customer"] = customer
    if posting_date:
        filters["posting_date"] = getdate(posting_date)

    rows = frappe.get_all(
        "Sales Invoice",
        filters=filters,
        fields=[
            "name",
            "docstatus",
            "customer",
            "customer_name",
            "company",
            "posting_date",
            "posting_time",
            "grand_total",
            "rounded_total",
            "outstanding_amount",
            "is_return",
            "return_against",
            "creation",
        ],
        order_by="creation desc",
        limit_page_length=_safe_int(limit, default=100, maximum=300),
    )

    total = sum(flt(row.rounded_total or row.grand_total) for row in rows)
    outstanding = sum(flt(row.outstanding_amount) for row in rows)

    return {
        "count": len(rows),
        "total": total,
        "outstanding": outstanding,
        "invoices": rows,
    }


@frappe.whitelist()
def get_available_stock(warehouse: str, txt: str | None = None, limit: int = 200) -> dict[str, Any]:
    """Return available stock rows for selected warehouse."""
    if not frappe.has_permission("Item", "read"):
        frappe.throw(_("You do not have permission to read Item."), frappe.PermissionError)

    warehouse = (warehouse or "").strip()
    if not warehouse:
        frappe.throw(_("Please select a warehouse first."))

    if not frappe.db.exists("Warehouse", warehouse):
        frappe.throw(_("Warehouse {0} does not exist.").format(warehouse))

    txt = (txt or "").strip()
    params = {"warehouse": warehouse, "limit": _safe_int(limit, default=200, maximum=500)}
    conditions = ["b.warehouse = %(warehouse)s", "ifnull(b.actual_qty, 0) > 0", "ifnull(i.disabled, 0) = 0"]

    if txt:
        params["txt"] = f"%{txt}%"
        conditions.append("(i.item_code LIKE %(txt)s OR i.item_name LIKE %(txt)s OR i.description LIKE %(txt)s)")

    rows = frappe.db.sql(
        f"""
        SELECT
            i.item_code,
            i.item_name,
            i.stock_uom,
            i.item_group,
            b.actual_qty,
            b.reserved_qty,
            b.projected_qty,
            (ifnull(b.actual_qty, 0) - ifnull(b.reserved_qty, 0)) AS available_qty
        FROM `tabBin` b
        INNER JOIN `tabItem` i ON i.name = b.item_code
        WHERE {' AND '.join(conditions)}
        ORDER BY i.item_code ASC
        LIMIT %(limit)s
        """,
        params,
        as_dict=True,
    )

    total_actual_qty = sum(flt(row.actual_qty) for row in rows)
    total_available_qty = sum(flt(row.available_qty) for row in rows)

    return {
        "warehouse": warehouse,
        "count": len(rows),
        "total_actual_qty": total_actual_qty,
        "total_available_qty": total_available_qty,
        "items": rows,
    }
