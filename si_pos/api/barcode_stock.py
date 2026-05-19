from typing import Any

import frappe
from frappe import _
from frappe.utils import flt


def clean(value: Any) -> str:
    return (str(value or "")).strip()


def actual_qty(item_code: str, warehouse: str | None = None):
    warehouse = clean(warehouse)
    if not warehouse:
        return None
    qty = frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty")
    return flt(qty)


@frappe.whitelist()
def get_cart_stock_status(items, warehouse: str | None = None):
    if not frappe.has_permission("Item", "read"):
        frappe.throw(_("You do not have permission to read Item."), frappe.PermissionError)

    if isinstance(items, str):
        items = frappe.parse_json(items) or []

    totals = {}
    for row in items or []:
        item_code = clean(row.get("item_code"))
        if item_code:
            totals[item_code] = totals.get(item_code, 0) + flt(row.get("qty"))

    rows = []
    has_warning = False
    for item_code, requested_qty in totals.items():
        qty = actual_qty(item_code, warehouse)
        warn = bool(qty is not None and flt(requested_qty) > flt(qty))
        rows.append({
            "item_code": item_code,
            "warehouse": warehouse,
            "actual_qty": qty,
            "available_qty": qty,
            "requested_qty": requested_qty,
            "has_stock_warning": warn,
        })
        if warn:
            has_warning = True

    return {"warehouse": warehouse, "has_warning": has_warning, "items": rows}


@frappe.whitelist()
def resolve_scan(txt: str, price_list: str | None = None, warehouse: str | None = None):
    txt = clean(txt)
    if not txt:
        frappe.throw(_("Scan text is required."))

    item_code = frappe.db.get_value("Item Barcode", {"barcode": txt}, "parent")
    if not item_code and frappe.db.exists("Item", txt):
        item_code = txt

    if item_code:
        details = frappe.call(
            "si_pos.api.si_pos.get_item_details",
            item_code=item_code,
            price_list=price_list,
            warehouse=warehouse,
        )
        details["resolved_by"] = "barcode_or_code"
        return details

    results = frappe.call(
        "si_pos.api.si_pos.search_items",
        txt=txt,
        price_list=price_list,
        warehouse=warehouse,
        limit=1,
    )
    if not results:
        frappe.throw(_("No item found for {0}.").format(txt))

    row = results[0]
    row["resolved_by"] = "search"
    return row
