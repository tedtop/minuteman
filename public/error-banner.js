// Shared #errorMessage banner used by both fuel_dispatch.html and
// fuel_farm.html. `message` is a plain string, or a [before, url, after]
// tuple for the rare message that needs a clickable link - callers hardcode
// that split themselves rather than this module auto-detecting URLs.
let errorHideTimeout = null;

function renderErrorBanner(message, sticky = false) {
    const errorElement = document.getElementById('errorMessage');
    errorElement.textContent = '';
    if (Array.isArray(message)) {
        const [before, url, after] = message;
        if (before) errorElement.appendChild(document.createTextNode(before));
        const link = document.createElement('a');
        link.href = url;
        link.textContent = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        errorElement.appendChild(link);
        if (after) errorElement.appendChild(document.createTextNode(after));
    } else {
        errorElement.textContent = message;
    }
    errorElement.style.display = 'block';
    if (errorHideTimeout) clearTimeout(errorHideTimeout);
    errorHideTimeout = sticky ? null : setTimeout(hideErrorBanner, 5000);
}

function hideErrorBanner() {
    if (errorHideTimeout) clearTimeout(errorHideTimeout);
    errorHideTimeout = null;
    document.getElementById('errorMessage').style.display = 'none';
}
