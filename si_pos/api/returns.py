from __future__ import annotations

from typing import Any

import frappe
from frappe import _
from frappe.utils import flt, nowdate


def _clean(value: Any) -> str:
    return (str(value or "")).strip()


def _to_float(value: Any) -> float:
    try:
        return flt(value)
    except Exception:
        return 0.0


def _invoice_total(doc) -> float:
    return flt(doc.get("rounded_total") or doc.get("grand_total") or 0)


def _get_returned_qty_map(sales_invoice: str) -> dict[str, float]:
    """Return already returned quantities against original SI item row names."""
    rows = frappe.db.sql(
        """
        SELECT
            sii.si_detail AS original_detail,
            ABS(SUM(sii.qty)) AS returned_qty
        FROM `tabSales Invoice Item` sii
        INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
        WHERE si.docstatus = 1
          AND si.is_return = 1
          AND si.return_against = %(sales_invoice)s
          AND IFNULL(sii.si_detail, '') != ''
        GROUP BY sii.si_detail
        """,
        {"sales_invoice": sales_invoice},
        as_dict=True,
    )
    return {row.original_detail: flt(row.returned_qty) for row in rows}


@frappe.whitelist()
def search_sales_invoices(txt: str = "", customer: str | None = None, limit: int = 20):
    """Search submitted non-return Sales Invoices for POS return/exchange."""
    if not frappe.has_permission("Sales Invoice", "read"):
        frappe.throw(_("You do not have permission to read Sales Invoice."), frappe.PermissionError)

    txt = _clean(txt)
    limit = min(max(int(limit or 20), 1), 50)

    filters = {
        "docstatus": 1,
        "is_return": 0,
    }
    if customer:
        filters["customer"] = customer

    or_filters = []
    if txt:
        or_filters = [
            ["Sales Invoice", "name", "like", f"%{txt}%"],
            ["Sales Invoice", "customer", "like", f"%{txt}%"],
            ["Sales Invoice", "customer_name", "like", f"%{txt}%"],
        ]

    rows = frappe.get_all(
        "Sales Invoice",
        filters=filters,
        or_filters=or_filters,
        fields=[
            "name",
            "customer",
            "customer_name",
            "company",
            "posting_date",
            "grand_total",
            "rounded_total",
            "outstanding_amount",
        ],
        order_by="posting_date desc, creation desc",
        limit_page_length=limit,
    )

    return rows


@frappe.whitelist()
def get_sales_invoice_for_return(sales_invoice: str):
    """Load an invoice with item returnable quantities."""
    if not frappe.has_permission("Sales Invoice", "read"):
        frappe.throw(_("You do not have permission to read Sales Invoice."), frappe.PermissionError)

    sales_invoice = _clean(sales_invoice)
    if not sales_invoice:
        frappe.throw(_("Sales Invoice is required."))

    doc = frappe.get_doc("Sales Invoice", sales_invoice)
    if doc.docstatus != 1:
        frappe.throw(_("Only submitted Sales Invoices can be returned."))
    if doc.is_return:
        frappe.throw(_("Return invoices cannot be returned from SI POS."))

    returned_map = _get_returned_qty_map(doc.name)
    items = []

    for row in doc.items:
        returned_qty = returned_map.get(row.name, 0)
        returnable_qty = max(flt(row.qty) - returned_qty, 0)
        if returnable_qty <= 0:
            continue

        items.append(
            {
                "name": row.name,
                "item_code": row.item_code,
                "item_name": row.item_name,
                "description": row.description,
                "uom": row.uom,
                "stock_uom": row.stock_uom,
                "qty": flt(row.qty),
                "returned_qty": returned_qty,
                "returnable_qty": returnable_qty,
                "rate": flt(row.rate),
                "amount": flt(row.amount),
                "warehouse": row.warehouse,
                "income_account": row.income_account,
                "cost_center": row.cost_center,
            }
        )

    return {
        "name": doc.name,
        "customer": doc.customer,
        "customer_name": doc.customer_name,
        "company": doc.company,
        "posting_date": doc.posting_date,
        "currency": doc.currency,
        "grand_total": doc.grand_total,
        "rounded_total": doc.rounded_total,
        "outstanding_amount": doc.outstanding_amount,
        "update_stock": doc.update_stock,
        "items": items,
    }


def _copy_taxes(original, target):
    target.set("taxes", [])
    if original.get("taxes_and_charges"):
        target.taxes_and_charges = original.taxes_and_charges

    for tax in original.get("taxes", []):
        target.append(
            "taxes",
            {
                "charge_type": tax.charge_type,
                "account_head": tax.account_head,
                "description": tax.description,
                "rate": tax.rate,
                "included_in_print_rate": tax.included_in_print_rate,
                "cost_center": tax.cost_center,
            },
        )


def _calculate(doc):
    for method_name in ("set_missing_values", "calculate_taxes_and_totals"):
        if hasattr(doc, method_name):
            doc.run_method(method_name)


@frappe.whitelist()
def create_sales_return(
    sales_invoice: str,
    return_items: list[dict[str, Any]] | str,
    reason: str | None = None,
    submit: int = 1,
):
    """Create a Sales Return against a submitted Sales Invoice.

    return_items format:
    [{"si_detail": "original child row name", "qty": 1}]
    Qty must be positive in input; this method creates negative return rows.
    """
    if not frappe.has_permission("Sales Invoice", "create"):
        frappe.throw(_("You do not have permission to create Sales Return."), frappe.PermissionError)

    if isinstance(return_items, str):
        return_items = frappe.parse_json(return_items) or []

    sales_invoice = _clean(sales_invoice)
    if not sales_invoice:
        frappe.throw(_("Sales Invoice is required."))
    if not return_items:
        frappe.throw(_("Please select at least one item to return."))

    original = frappe.get_doc("Sales Invoice", sales_invoice)
    if original.docstatus != 1:
        frappe.throw(_("Only submitted Sales Invoices can be returned."))
    if original.is_return:
        frappe.throw(_("Return invoice cannot be returned again."))

    returned_map = _get_returned_qty_map(original.name)
    original_rows = {row.name: row for row in original.items}

    ret = frappe.new_doc("Sales Invoice")
    ret.is_return = 1
    ret.return_against = original.name
    ret.company = original.company
    ret.customer = original.customer
    ret.posting_date = nowdate()
    ret.selling_price_list = original.selling_price_list
    ret.currency = original.currency
    ret.conversion_rate = original.conversion_rate
    ret.debit_to = original.debit_to
    ret.update_stock = 1 if original.get("update_stock") else 0
    ret.remarks = _clean(reason) or f"Sales Return against {original.name}"

    if original.get("set_warehouse"):
        ret.set_warehouse = original.set_warehouse

    for item in return_items:
        si_detail = _clean(item.get("si_detail") or item.get("name"))
        return_qty = _to_float(item.get("qty"))
        if not si_detail or return_qty <= 0:
            continue

        original_row = original_rows.get(si_detail)
        if not original_row:
            frappe.throw(_("Invalid return item row {0}.").format(si_detail))

        already_returned = returned_map.get(si_detail, 0)
        max_returnable = max(flt(original_row.qty) - already_returned, 0)
        if return_qty > max_returnable:
            frappe.throw(
                _("Return qty for item {0} cannot exceed returnable qty {1}.").format(
                    original_row.item_code,
                    max_returnable,
                )
            )

        ret.append(
            "items",
            {
                "item_code": original_row.item_code,
                "item_name": original_row.item_name,
                "description": original_row.description,
                "qty": -abs(return_qty),
                "uom": original_row.uom,
                "stock_uom": original_row.stock_uom,
                "conversion_factor": original_row.conversion_factor,
                "rate": original_row.rate,
                "price_list_rate": original_row.price_list_rate,
                "warehouse": original_row.warehouse or original.get("set_warehouse"),
                "income_account": original_row.income_account,
                "expense_account": original_row.expense_account,
                "cost_center": original_row.cost_center,
                "si_detail": original_row.name,
            },
        )

    if not ret.items:
        frappe.throw(_("Please enter a valid return quantity."))

    _copy_taxes(original, ret)

    if original.get("apply_discount_on"):
        ret.apply_discount_on = original.apply_discount_on
    if original.get("additional_discount_percentage"):
        ret.additional_discount_percentage = original.additional_discount_percentage
    if original.get("discount_amount"):
        original_total = _invoice_total(original)
        selected_amount = sum(abs(flt(row.amount)) for row in ret.items)
        ratio = selected_amount / original_total if original_total else 0
        ret.discount_amount = flt(original.discount_amount) * ratio

    _calculate(ret)
    ret.insert()

    if int(submit or 0):
        ret.submit()

    return {
        "name": ret.name,
        "docstatus": ret.docstatus,
        "is_return": ret.is_return,
        "return_against": ret.return_against,
        "grand_total": ret.grand_total,
        "rounded_total": ret.rounded_total,
        "outstanding_amount": ret.outstanding_amount,
        "route": f"/app/sales-invoice/{ret.name}",
        "print_route": f"/app/print/Sales%20Invoice/{ret.name}",
    }
