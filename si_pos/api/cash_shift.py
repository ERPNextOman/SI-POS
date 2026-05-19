from __future__ import annotations

from typing import Any

import frappe
from frappe import _
from frappe.utils import flt, now_datetime, nowdate, getdate


DENOMINATIONS = [50, 20, 10, 5, 1, 0.5, 0.1, 0.05]


def _clean(value: Any) -> str:
    return (str(value or "")).strip()


def _get_default_company(company: str | None = None) -> str | None:
    return _clean(company) or frappe.defaults.get_user_default("Company") or frappe.defaults.get_global_default("company")


def _normalise_denominations(rows: list[dict[str, Any]] | str | None) -> list[dict[str, Any]]:
    if isinstance(rows, str):
        rows = frappe.parse_json(rows) or []

    qty_by_denom = {flt(row.get("denomination")): flt(row.get("qty")) for row in (rows or [])}
    out = []
    for denom in DENOMINATIONS:
        qty = qty_by_denom.get(flt(denom), 0)
        out.append({"denomination": denom, "qty": qty, "amount": flt(denom) * qty})
    return out


def _total(rows: list[dict[str, Any]]) -> float:
    return sum(flt(row.get("amount")) for row in rows or [])


def _open_shift(company: str, warehouse: str, cashier: str | None = None):
    cashier = cashier or frappe.session.user
    return frappe.db.get_value(
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


@frappe.whitelist()
def get_denominations():
    return DENOMINATIONS


@frappe.whitelist()
def get_open_shift(company: str | None = None, warehouse: str | None = None):
    company = _get_default_company(company)
    warehouse = _clean(warehouse)
    if not company or not warehouse:
        return {"exists": False, "needs_shift": True, "message": "Company and warehouse required."}

    name = _open_shift(company, warehouse)
    if not name:
        return {"exists": False, "needs_shift": True, "company": company, "warehouse": warehouse}

    doc = frappe.get_doc("SI POS Cash Shift", name)
    return {
        "exists": True,
        "needs_shift": False,
        "name": doc.name,
        "company": doc.company,
        "warehouse": doc.warehouse,
        "cashier": doc.cashier,
        "opening_amount": doc.opening_amount,
        "opening_datetime": doc.opening_datetime,
        "status": doc.status,
    }


@frappe.whitelist()
def start_shift(company: str, warehouse: str, opening_denominations: list[dict[str, Any]] | str, remarks: str | None = None):
    if not frappe.has_permission("SI POS Cash Shift", "create"):
        frappe.throw(_("You do not have permission to create Cash Shift."), frappe.PermissionError)

    company = _get_default_company(company)
    warehouse = _clean(warehouse)
    if not company:
        frappe.throw(_("Company is required."))
    if not warehouse:
        frappe.throw(_("Warehouse is required."))

    existing = _open_shift(company, warehouse)
    if existing:
        return get_open_shift(company, warehouse)

    rows = _normalise_denominations(opening_denominations)

    doc = frappe.new_doc("SI POS Cash Shift")
    doc.company = company
    doc.warehouse = warehouse
    doc.cashier = frappe.session.user
    doc.status = "Open"
    doc.opening_datetime = now_datetime()
    doc.remarks = _clean(remarks)
    for row in rows:
        doc.append("opening_denominations", row)
    doc.insert()

    return {
        "exists": True,
        "needs_shift": False,
        "name": doc.name,
        "opening_amount": doc.opening_amount,
        "company": company,
        "warehouse": warehouse,
        "status": doc.status,
    }


@frappe.whitelist()
def close_shift(company: str, warehouse: str, closing_denominations: list[dict[str, Any]] | str, closing_summary: dict[str, Any] | str | None = None, remarks: str | None = None):
    company = _get_default_company(company)
    warehouse = _clean(warehouse)
    if not company or not warehouse:
        frappe.throw(_("Company and Warehouse are required."))

    name = _open_shift(company, warehouse)
    if not name:
        frappe.throw(_("No open cash shift found."))

    if isinstance(closing_summary, str):
        closing_summary = frappe.parse_json(closing_summary) or {}
    closing_summary = closing_summary or {}

    rows = _normalise_denominations(closing_denominations)
    closing_amount = _total(rows)

    doc = frappe.get_doc("SI POS Cash Shift", name)
    doc.set("closing_denominations", [])
    for row in rows:
        doc.append("closing_denominations", row)

    doc.status = "Closed"
    doc.closing_datetime = now_datetime()
    doc.closing_amount = closing_amount
    doc.sales_total = flt(closing_summary.get("sales_total"))
    doc.advance_total = flt(closing_summary.get("advance_total"))
    doc.expense_total = flt(closing_summary.get("expense_total"))
    doc.discount_total = flt(closing_summary.get("discount_total"))
    doc.bank_deposit_total = flt(closing_summary.get("deposit_total"))
    doc.available_till_balance = flt(closing_summary.get("available_till_balance"))
    doc.cash_sales_total = flt(closing_summary.get("cash_sales_total"))
    doc.till_available_balance = flt(closing_summary.get("till_available_balance"))
    doc.difference = closing_amount - flt(closing_summary.get("available_till_balance"))
    if remarks:
        doc.remarks = _clean(remarks)
    doc.save()

    return {
        "name": doc.name,
        "status": doc.status,
        "closing_amount": doc.closing_amount,
        "difference": doc.difference,
        "route": f"/app/si-pos-cash-shift/{doc.name}",
    }
