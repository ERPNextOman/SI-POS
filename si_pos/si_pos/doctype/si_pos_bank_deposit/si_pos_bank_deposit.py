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


def _get_default_bank_account(company: str) -> str | None:
    return frappe.db.get_value(
        "Account",
        {"company": company, "is_group": 0, "account_type": "Bank"},
        "name",
        order_by="name asc",
    )


class SIPOSBankDeposit(Document):
    def validate(self):
        self.amount = flt(self.amount)
        if self.amount <= 0:
            frappe.throw(_("Amount must be greater than zero."))

        if not _clean(self.bank_name):
            frappe.throw(_("Bank Name is required."))

        if not self.cashier:
            self.cashier = frappe.session.user

        if not self.from_account:
            self.from_account = _get_mop_account(self.from_mode_of_payment, self.company)

        if not self.bank_account:
            self.bank_account = _get_default_bank_account(self.company)

        if not self.from_account:
            frappe.throw(_("Please set From Account or select a Mode of Payment with a default account."))

        if not self.bank_account:
            frappe.throw(_("Please set Bank Account."))

    def on_submit(self):
        if self.journal_entry:
            return

        je = frappe.new_doc("Journal Entry")
        je.voucher_type = "Journal Entry"
        je.company = self.company
        je.posting_date = self.posting_date
        je.user_remark = self.remarks or f"SI POS Bank Deposit to {self.bank_name}"
        je.append(
            "accounts",
            {
                "account": self.bank_account,
                "debit_in_account_currency": self.amount,
            },
        )
        je.append(
            "accounts",
            {
                "account": self.from_account,
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
