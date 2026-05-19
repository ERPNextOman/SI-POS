app_name = "si_pos"
app_title = "SI POS"
app_publisher = "ERPNextOman"
app_description = "POS-style Sales Invoice screen for ERPNext"
app_email = "support@erpnextoman.com"
app_license = "MIT"
required_apps = ["frappe", "erpnext"]

# Extra Desk JS adds optional POS UI helpers such as print format selector,
# quick customer creation, and daily closing dialog.
app_include_js = ["/assets/si_pos/js/si_pos_extras.js"]

# Phase 1 uses a standard Desk Page at /app/si-pos.
# No document events are required yet.
