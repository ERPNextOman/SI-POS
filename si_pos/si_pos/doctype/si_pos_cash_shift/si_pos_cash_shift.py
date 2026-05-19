from __future__ import annotations

from typing import Any

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, now_datetime


DENOMINATIONS = [50, 20, 10, 5, 1, 0.5, 0.1, 0.05]


def _amount(rows: list[Any]) -> float:
    total = 0.0
    for row in rows or []:
        row.amount = flt(row.denomination) * flt(row.qty)
        total += flt(row.amount)
    return total


class SIPOSCashShift(Document):
    def validate(self):
        if not self.cashier:
            self.cashier = frappe.session.user

        if not self.status:
            self.status = "Open"

        if not self.opening_datetime:
            self.opening_datetime = now_datetime()

        self.opening_amount = _amount(self.opening_denominations)
        self.closing_amount = _amount(self.closing_denominations)

        if self.status == "Closed" and not self.closing_datetime:
            self.closing_datetime = now_datetime()

    def before_insert(self):
        if self.status == "Open":
            existing = frappe.db.get_value(
                "SI POS Cash Shift",
                {
                    "docstatus": ["<", 2],
                    "status": "Open",
                    "cashier": self.cashier,
                    "company": self.company,
                    "warehouse": self.warehouse,
                },
                "name",
            )
            if existing:
                frappe.throw(_("Open cash shift already exists: {0}").format(existing))
