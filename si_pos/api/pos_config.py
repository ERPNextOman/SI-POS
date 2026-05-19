import frappe


@frappe.whitelist()
def get_pos_config():
    doctype = "SI POS Settings"
    if not frappe.db.exists("DocType", doctype):
        return {}

    def get(fieldname, default=None):
        value = frappe.db.get_single_value(doctype, fieldname)
        return default if value in (None, "") else value

    return {
        "default_company": get("default_company"),
        "default_customer": get("default_customer"),
        "default_price_list": get("default_price_list"),
        "default_warehouse": get("default_warehouse"),
        "default_cash_mode": get("default_cash_mode"),
        "default_card_mode": get("default_card_mode"),
        "vat_rate": get("vat_rate", 5),
        "vat_inclusive": get("vat_inclusive", 1),
        "default_print_format": get("default_print_format"),
        "auto_print": get("auto_print", 1),
        "auto_clear_cart": get("auto_clear_cart", 1),
    }
