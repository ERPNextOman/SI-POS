(function () {
    if (window.__si_pos_print_patch_installed) return;
    window.__si_pos_print_patch_installed = true;

    const originalOpen = window.open;

    function isSiPosPage() {
        return window.location.pathname.includes('/app/si-pos');
    }

    function selectedPrintFormat() {
        const value = $('.si-extra-print-format').val();
        return value ? String(value).trim() : '';
    }

    function shouldPatchUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return isSiPosPage() && url.includes('/app/print/Sales%20Invoice/');
    }

    function addPrintFormat(url) {
        const format = selectedPrintFormat();
        if (!format) return url;

        const separator = url.includes('?') ? '&' : '?';
        if (url.includes('format=')) return url;

        return `${url}${separator}format=${encodeURIComponent(format)}`;
    }

    window.open = function (url, target, features) {
        if (shouldPatchUrl(url)) {
            url = addPrintFormat(url);
        }
        return originalOpen.call(window, url, target, features);
    };
})();
