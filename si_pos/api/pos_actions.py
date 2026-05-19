from __future__ import annotations

from collections import defaultdict
from typing import Any

import frappe
from frappe import _
from frappe.utils import flt, getdate, nowdate


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
