(function () {
    if (window.__si_pos_print_patch_installed_v2) return;
    window.__si_pos_print_patch_installed_v2 = true;

    const originalOpen = window.open;

    function isSiPosPage() {
        return window.location.pathname.includes('/app/si-pos');
    }

    function selectedPrintFormat() {
        const fromDropdown = $('.si-extra-print-format').val();
        const fromInstance = window.si_pos_current_instance && window.si_pos_current_instance.selected_print_format
            ? window.si_pos_current_instance.selected_print_format()
            : '';
        const value = fromDropdown || fromInstance || '';
        return value ? String(value).trim() : '';
    }

    function shouldPatchUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return isSiPosPage() && url.includes('/app/print/Sales%20Invoice/');
    }

    function addPrintFormat(url) {
        const printFormat = selectedPrintFormat();
        if (!printFormat) return url;

        let cleanUrl = url.replace(/([?&])(format|print_format)=[^&]*/g, '');
        cleanUrl = cleanUrl.replace('?&', '?').replace(/\?$/, '').replace(/&$/, '');
        const separator = cleanUrl.includes('?') ? '&' : '?';

        // ERPNext print view commonly uses print_format. Keep format too for compatibility.
        return `${cleanUrl}${separator}print_format=${encodeURIComponent(printFormat)}&format=${encodeURIComponent(printFormat)}`;
    }

    window.open = function (url, target, features) {
        if (shouldPatchUrl(url)) {
            url = addPrintFormat(url);
        }
        return originalOpen.call(window, url, target, features);
    };
})();
