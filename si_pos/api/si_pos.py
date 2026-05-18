import json
import re
from typing import Any

import frappe
from frappe import _


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
    return [field for field in DEFAULT_SEARCH_FIELDS if field in [d.fieldname for d in meta.fields] or field in {"item_code", "item_name", "description"}]


def _tokenize_search_text(txt: str) -> list[str]:
    txt = _clean_text(txt)
    if not txt:
        return []
    # Split words but keep part numbers like 28110-2H000 usable.
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
    return selling_settings.selling_price_list or frappe.db.get_single_value("Selling Settings", "selling_price_list")


def _get_item_price(item_code: str, price_list: str | None = None, uom: str | None = None) -> float:
    filters = {
        "item_code": item_code,
        "selling": 1,
    }

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

    # Fallback: try Standard Selling if no selected price list rate exists.
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


@frappe.whitelist()
def get_defaults() -> dict[str, Any]:
    """Return small defaults needed by the SI POS page."""
    if not frappe.has_permission("Sales Invoice", "create"):
        frappe.throw(_("You do not have permission to create Sales Invoice."), frappe.PermissionError)

    return {
        "company": _get_default_company(),
        "price_list": _get_default_price_list(),
        "currency": frappe.defaults.get_global_default("currency") or "OMR",
    }


@frappe.whitelist()
def search_items(txt: str = "", price_list: str | None = None, warehouse: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    """Search sales items for the custom SI POS screen.

    The search supports multi-word matching. Example: searching `Gen Case` can match
    item names such as `28110-2H000 Gen AIR FILTER CASE HYUNDAI`.
    """
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
            "EXISTS (SELECT 1 FROM `tabItem Barcode` ib WHERE ib.parent = i.name AND ib.barcode LIKE %({})s)".format(key)
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
def get_item_details(item_code: str, price_list: str | None = None, warehouse: str | None = None) -> dict[str, Any]:
    """Return a single item details payload for adding to the POS cart."""
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
def create_sales_invoice(
    customer: str,
    items: str | list[dict[str, Any]],
    company: str | None = None,
    price_list: str | None = None,
    set_warehouse: str | None = None,
) -> dict[str, Any]:
    """Create a Draft Sales Invoice from the SI POS cart.

    Phase 1 deliberately creates docstatus 0 only. Submit/payment will come later.
    """
    if not frappe.has_permission("Sales Invoice", "create"):
        frappe.throw(_("You do not have permission to create Sales Invoice."), frappe.PermissionError)

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

        item_row = {
            "item_code": item_code,
            "qty": qty,
            "rate": rate,
        }
        if uom:
            item_row["uom"] = uom

        invoice.append("items", item_row)

    invoice.insert()

    return {
        "name": invoice.name,
        "grand_total": invoice.grand_total,
        "rounded_total": invoice.rounded_total,
        "currency": invoice.currency,
        "route": f"/app/sales-invoice/{invoice.name}",
    }
