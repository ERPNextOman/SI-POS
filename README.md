# SI POS

A Phase 1 Frappe/ERPNext custom app that provides a colorful POS-style Desk Page backed by the standard ERPNext **Sales Invoice** doctype.

## Phase 1 Scope

This version intentionally keeps the feature set small and safe:

- Select Company
- Select Customer
- Select Price List
- Search sales items
- Add items to cart
- Edit qty and rate
- Create a **Draft Sales Invoice**
- Open the created Sales Invoice

Not included yet:

- Submit invoice
- Payment handling
- Barcode hardware support
- Returns
- Hold/resume invoices
- Offline mode

## Install

From your bench folder:

```bash
bench get-app https://github.com/ERPNextOman/SI-POS --branch main
bench --site your-site-name install-app si_pos
bench --site your-site-name clear-cache
bench restart
```

Open:

```text
/app/si-pos
```

## Permissions

The user must have permission to create Sales Invoice documents. Recommended roles:

- Sales User
- Sales Manager
- System Manager

## Main Files

```text
si_pos/hooks.py
si_pos/api/si_pos.py
si_pos/si_pos/page/si_pos/si_pos.json
si_pos/si_pos/page/si_pos/si_pos.js
```

## Notes

This app does not replace ERPNext POS. It creates a custom POS-style interface that creates a normal ERPNext Sales Invoice draft.
