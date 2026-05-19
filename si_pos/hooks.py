app_name = "si_pos"
app_title = "SI POS"
app_publisher = "ERPNextOman"
app_description = "POS-style Sales Invoice screen for ERPNext"
app_email = "support@erpnextoman.com"
app_license = "MIT"
required_apps = ["frappe", "erpnext"]

# Extra Desk JS adds optional POS UI helpers such as customer creation,
# sales invoice list, available stock, daily closing, print routing,
# barcode scan, stock warning, return/exchange, and cash control tools.
app_include_js = [
    "/assets/si_pos/js/si_pos_extras.js",
    "/assets/si_pos/js/si_pos_header_tools_v2.js",
    "/assets/si_pos/js/si_pos_cash_tools_v1.js",
    "/assets/si_pos/js/si_pos_print_patch.js",
    "/assets/si_pos/js/si_pos_phase4.js",
    "/assets/si_pos/js/si_pos_phase5.js",
]

# Phase 1 uses a standard Desk Page at /app/si-pos.
# No document events are required yet.
