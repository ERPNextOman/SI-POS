from __future__ import annotations

from typing import Any

import frappe
from frappe import _
from frappe.utils import flt, nowdate


def _clean(value: Any) -> str:
    return (str(value or "")).strip()


def _get_default_company(company: str | None = None) -> str | None:
    return _clean(company) or frappe.defaults.get_user_default("Company") or frappe.defaults.get_global_default("company")


def _get_mop_account(mode_of_payment: str, company: str) -> str | None:
    mode_of_payment = _clean(mode_of_payment)
    if not mode_of_payment:
        return None
    account = frappe.db.get_value(
        "Mode of Payment Account",
        {"parent": mode_of_payment, "company": company},
        "default_account",
    )
    if not account:
        account = frappe.db.get_value("Mode of Payment Account", {"parent": mode_of_payment}, "default_account")
    return account


def _get_party_account(company: str, customer: str) -> str:
    account = None
    try:
        from erpnext.accounts.party import get_party_account

        account = get_party_account("Customer", customer, company)
    except Exception:
        account = None

    if not account:
        account = frappe.db.get_value("Company", company, "default_receivable_account")
    if not account:
        frappe.throw(_("Could not find receivable account for customer {0}." ).format(customer))
    return account


def _get_default_expense_account(company: str) -> str | None:
    account = frappe.db.get_value("Company", company, "default_expense_account")
    if account:
        return account
    return frappe.db.get_value("Account", {"company": company, "is_group": 0, "root_type": "Expense"}, "name")


def _get_default_bank_account(company: str) -> str | None:
    return frappe.db.get_value(
        "Account",
        {"company": company, "is_group": 0, "account_type": "Bank"},
        "name",
        order_by="name asc",
    )


def _make_journal_entry(company: str, posting_date: str, accounts: list[dict[str, Any]], remarks: str | None = None):
    if not frappe.has_permission("Journal Entry", "create"):
        frappe.throw(_("You do not have permission to create Journal Entry."), frappe.PermissionError)

    je = frappe.new_doc("Journal Entry")
    je.voucher_type = "Journal Entry"
    je.company = company
    je.posting_date = posting_date
    je.user_remark = remarks or "SI POS cash control entry"

    for row in accounts:
        je.append("accounts", row)

    je.insert()
    je.submit()
    return je


@frappe.whitelist()
def create_customer_advance(
    customer: str,
    amount: float,
    company: str | None = None,
    mode_of_payment: str | None = None,
    paid_to: str | None = None,
    reference_no: str | None = None,
    remarks: str | None = None,
):
    """Create submitted Customer Advance Payment Entry from POS."""
    if not frappe.has_permission("Payment Entry", "create"):
        frappe.throw(_("You do not have permission to create Payment Entry."), frappe.PermissionError)

    customer = _clean(customer)
    if not customer:
        frappe.throw(_("Customer is required."))
    if not frappe.db.exists("Customer", customer):
        frappe.throw(_("Customer {0} does not exist.").format(customer))

    amount = flt(amount)
    if amount <= 0:
        frappe.throw(_("Amount must be greater than zero."))

    company = _get_default_company(company)
    if not company:
        frappe.throw(_("Company is required."))

    paid_to = _clean(paid_to) or _get_mop_account(mode_of_payment or "", company)
    if not paid_to:
        frappe.throw(_("Please select Mode of Payment with account or Paid To account."))

    paid_from = _get_party_account(company, customer)

    pe = frappe.new_doc("Payment Entry")
    pe.payment_type = "Receive"
    pe.company = company
    pe.posting_date = nowdate()
    pe.mode_of_payment = _clean(mode_of_payment)
    pe.party_type = "Customer"
    pe.party = customer
    pe.paid_from = paid_from
    pe.paid_to = paid_to
    pe.paid_amount = amount
    pe.received_amount = amount
    pe.reference_no = _clean(reference_no) or f"SI-POS-ADV-{frappe.generate_hash(length=8)}"
    pe.reference_date = nowdate()
    pe.remarks = _clean(remarks) or f"Customer advance received from SI POS for {customer}"
    pe.insert()
    pe.submit()

    return {
        "name": pe.name,
        "docstatus": pe.docstatus,
        "amount": amount,
        "customer": customer,
        "route": f"/app/payment-entry/{pe.name}",
    }


@frappe.whitelist()
def create_daily_expense(
    amount: float,
    purpose: str,
    company: str | None = None,
    warehouse: str | None = None,
    mode_of_payment: str | None = None,
    paid_from: str | None = None,
    expense_account: str | None = None,
    remarks: str | None = None,
):
    """Create and submit SI POS Daily Expense and linked Journal Entry."""
    if not frappe.has_permission("SI POS Daily Expense", "create"):
        frappe.throw(_("You do not have permission to create Daily Expense."), frappe.PermissionError)

    amount = flt(amount)
    if amount <= 0:
        frappe.throw(_("Amount must be greater than zero."))
    purpose = _clean(purpose)
    if not purpose:
        frappe.throw(_("Purpose is required."))

    company = _get_default_company(company)
    if not company:
        frappe.throw(_("Company is required."))

    paid_from = _clean(paid_from) or _get_mop_account(mode_of_payment or "", company)
    expense_account = _clean(expense_account) or _get_default_expense_account(company)

    if not paid_from:
        frappe.throw(_("Please select Mode of Payment with account or Paid From account."))
    if not expense_account:
        frappe.throw(_("Please select Expense Account."))

    je = _make_journal_entry(
        company=company,
        posting_date=nowdate(),
        remarks=f"SI POS Daily Expense: {purpose}",
        accounts=[
            {"account": expense_account, "debit_in_account_currency": amount},
            {"account": paid_from, "credit_in_account_currency": amount},
        ],
    )

    doc = frappe.new_doc("SI POS Daily Expense")
    doc.posting_date = nowdate()
    doc.company = company
    doc.cashier = frappe.session.user
    doc.warehouse = _clean(warehouse)
    doc.amount = amount
    doc.mode_of_payment = _clean(mode_of_payment)
    doc.expense_account = expense_account
    doc.purpose = purpose
    doc.remarks = _clean(remarks)
    doc.journal_entry = je.name
    doc.insert()
    doc.submit()

    return {"name": doc.name, "journal_entry": je.name, "amount": amount, "route": f"/app/si-pos-daily-expense/{doc.name}"}


@frappe.whitelist()
def create_bank_deposit(
    bank_name: str,
    amount: float,
    company: str | None = None,
    warehouse: str | None = None,
    from_mode_of_payment: str | None = None,
    from_account: str | None = None,
    bank_account: str | None = None,
    reference_no: str | None = None,
    remarks: str | None = None,
):
    """Create and submit SI POS Bank Deposit and linked Journal Entry."""
    if not frappe.has_permission("SI POS Bank Deposit", "create"):
        frappe.throw(_("You do not have permission to create Bank Deposit."), frappe.PermissionError)

    bank_name = _clean(bank_name)
    if not bank_name:
        frappe.throw(_("Bank Name is required."))
    amount = flt(amount)
    if amount <= 0:
        frappe.throw(_("Amount must be greater than zero."))

    company = _get_default_company(company)
    if not company:
        frappe.throw(_("Company is required."))

    from_account = _clean(from_account) or _get_mop_account(from_mode_of_payment or "", company)
    bank_account = _clean(bank_account) or _get_default_bank_account(company)
    if not from_account:
        frappe.throw(_("Please select From Mode of Payment with account or From Account."))
    if not bank_account:
        frappe.throw(_("Please select Bank Account."))

    je = _make_journal_entry(
        company=company,
        posting_date=nowdate(),
        remarks=f"SI POS Bank Deposit to {bank_name}",
        accounts=[
            {"account": bank_account, "debit_in_account_currency": amount},
            {"account": from_account, "credit_in_account_currency": amount},
        ],
    )

    doc = frappe.new_doc("SI POS Bank Deposit")
    doc.posting_date = nowdate()
    doc.company = company
    doc.cashier = frappe.session.user
    doc.warehouse = _clean(warehouse)
    doc.bank_name = bank_name
    doc.amount = amount
    doc.from_mode_of_payment = _clean(from_mode_of_payment)
    doc.from_account = from_account
    doc.bank_account = bank_account
    doc.reference_no = _clean(reference_no)
    doc.remarks = _clean(remarks)
    doc.journal_entry = je.name
    doc.insert()
    doc.submit()

    return {"name": doc.name, "journal_entry": je.name, "amount": amount, "route": f"/app/si-pos-bank-deposit/{doc.name}"}
