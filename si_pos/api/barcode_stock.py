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


def _item_price(item_code: str, price_list: str | None = None, uom: str | None = None) -> float:
    price_list = clean(price_list)
    filters = {"item_code": item_code, "selling": 1}
    if price_list:
        filters["price_list"] = price_list

    if uom:
        price = frappe.db.get_value("Item Price", {**filters, "uom": uom}, "price_list_rate")
        if price is not None:
            return flt(price)

    price = frappe.db.get_value(
        "Item Price",
        filters,
        "price_list_rate",
        order_by="valid_from desc, modified desc",
    )
    if price is not None:
        return flt(price)

    price = frappe.db.get_value(
        "Item Price",
        {"item_code": item_code, "selling": 1, "price_list": "Standard Selling"},
        "price_list_rate",
        order_by="valid_from desc, modified desc",
    )
    return flt(price)


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
def get_stock_item_cards(
    warehouse: str,
    price_list: str | None = None,
    txt: str | None = None,
    limit: int = 48,
):
    """Return item cards that have positive stock in the selected warehouse."""
    if not frappe.has_permission("Item", "read"):
        frappe.throw(_("You do not have permission to read Item."), frappe.PermissionError)

    warehouse = clean(warehouse)
    if not warehouse:
        frappe.throw(_("Warehouse is required to show available stock items."))

    if not frappe.db.exists("Warehouse", warehouse):
        frappe.throw(_("Warehouse {0} does not exist.").format(warehouse))

    try:
        limit = int(limit or 48)
    except Exception:
        limit = 48
    limit = max(1, min(limit, 100))

    txt = clean(txt)
    params = {"warehouse": warehouse, "limit": limit}
    where = [
        "b.warehouse = %(warehouse)s",
        "ifnull(b.actual_qty, 0) > 0",
        "ifnull(i.disabled, 0) = 0",
        "ifnull(i.is_sales_item, 1) = 1",
    ]

    if txt:
        params["txt"] = f"%{txt}%"
        where.append(
            "(" 
            "i.item_code LIKE %(txt)s "
            "OR i.item_name LIKE %(txt)s "
            "OR i.description LIKE %(txt)s "
            "OR EXISTS (SELECT 1 FROM `tabItem Barcode` ib WHERE ib.parent = i.name AND ib.barcode LIKE %(txt)s)"
            ")"
        )

    rows = frappe.db.sql(
        f"""
        SELECT
            i.item_code,
            i.item_name,
            i.stock_uom,
            i.sales_uom,
            i.image,
            i.item_group,
            b.actual_qty
        FROM `tabBin` b
        INNER JOIN `tabItem` i ON i.name = b.item_code
        WHERE {' AND '.join(where)}
        ORDER BY i.item_name ASC, i.item_code ASC
        LIMIT %(limit)s
        """,
        params,
        as_dict=True,
    )

    result = []
    for row in rows:
        uom = row.sales_uom or row.stock_uom
        result.append({
            "item_code": row.item_code,
            "item_name": row.item_name,
            "uom": uom,
            "stock_uom": row.stock_uom,
            "rate": _item_price(row.item_code, price_list=price_list, uom=uom),
            "image": row.image,
            "item_group": row.item_group,
            "actual_qty": flt(row.actual_qty),
            "available_qty": flt(row.actual_qty),
        })

    return result


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

    results = get_stock_item_cards(
        warehouse=warehouse,
        price_list=price_list,
        txt=txt,
        limit=1,
    ) if warehouse else frappe.call(
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
