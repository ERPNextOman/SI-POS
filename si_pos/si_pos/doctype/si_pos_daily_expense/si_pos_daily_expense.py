from __future__ import annotations

from typing import Any

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


def _clean(value: Any) -> str:
    return (str(value or "")).strip()


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
        account = frappe.db.get_value(
            "Mode of Payment Account",
            {"parent": mode_of_payment},
            "default_account",
        )
    return account


def _get_default_expense_account(company: str) -> str | None:
    account = frappe.db.get_value("Company", company, "default_expense_account")
    if account:
        return account

    return frappe.db.get_value(
        "Account",
        {"company": company, "is_group": 0, "root_type": "Expense"},
        "name",
        order_by="name asc",
    )


class SIPOSDailyExpense(Document):
    def validate(self):
        self.amount = flt(self.amount)
        if self.amount <= 0:
            frappe.throw(_("Amount must be greater than zero."))

        if not _clean(self.purpose):
            frappe.throw(_("Purpose is required."))

        if not self.cashier:
            self.cashier = frappe.session.user

        if not self.paid_from:
            self.paid_from = _get_mop_account(self.mode_of_payment, self.company)

        if not self.expense_account:
            self.expense_account = _get_default_expense_account(self.company)

        if not self.paid_from:
            frappe.throw(_("Please set Paid From Account or select a Mode of Payment with a default account."))

        if not self.expense_account:
            frappe.throw(_("Please set Expense Account."))

    def on_submit(self):
        if self.journal_entry:
            return

        je = frappe.new_doc("Journal Entry")
        je.voucher_type = "Journal Entry"
        je.company = self.company
        je.posting_date = self.posting_date
        je.user_remark = self.remarks or f"SI POS Daily Expense: {self.purpose}"
        je.append(
            "accounts",
            {
                "account": self.expense_account,
                "debit_in_account_currency": self.amount,
            },
        )
        je.append(
            "accounts",
            {
                "account": self.paid_from,
                "credit_in_account_currency": self.amount,
            },
        )
        je.insert(ignore_permissions=True)
        je.submit()

        self.db_set("journal_entry", je.name, update_modified=False)

    def on_cancel(self):
        if not self.journal_entry:
            return

        je = frappe.get_doc("Journal Entry", self.journal_entry)
        if je.docstatus == 1:
            je.cancel()
