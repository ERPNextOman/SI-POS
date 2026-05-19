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
    cashier: str | None = None,
) -> dict[str, Any]:
    """Return a cashier-wise same-day closing summary for SI POS.

    The cashier is based on Sales Invoice owner by default. System Manager may
    pass another cashier if needed.
    """
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
    outstanding_total = 0.0
    for row in invoices:
        invoice_total += flt(row.rounded_total or row.grand_total)
        outstanding_total += flt(row.outstanding_amount)

    paid_total = sum(mode_totals.values())

    return {
        "posting_date": str(posting_date),
        "company": company,
        "cashier": cashier,
        "invoice_count": len(invoices),
        "invoice_total": invoice_total,
        "paid_total": paid_total,
        "outstanding_total": outstanding_total,
        "mode_totals": dict(mode_totals),
        "invoices": invoices,
        "payment_entries": payment_entries,
    }


@frappe.whitelist()
def get_created_sales_invoices(
    company: str | None = None,
    customer: str | None = None,
    posting_date: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    """Return Sales Invoices created by the current cashier/user.

    This is meant for the SI POS quick view button. System Manager can later be
    extended to view all cashiers, but normal users see their own invoices.
    """
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
