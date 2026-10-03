"use strict";

(() => {
    const header = document.querySelector(".site-header");
    const navLinks = [...document.querySelectorAll(".site-nav a")];

    if (!header || !navLinks.length) {
        return;
    }

    const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";

    navLinks.forEach(link => {
        const linkPath = new URL(link.href, window.location.origin)
            .pathname
            .replace(/\/+$/, "") || "/";

        link.classList.toggle("active", linkPath === currentPath);
    });

    let lastScrollY = window.scrollY;
    let ticking = false;

    const updateHeader = () => {
        header.classList.toggle("is-scrolled", window.scrollY > 10);
        lastScrollY = window.scrollY;
        ticking = false;
    };

    window.addEventListener("scroll", () => {
        if (!ticking) {
            window.requestAnimationFrame(updateHeader);
            ticking = true;
        }
    }, { passive: true });

    updateHeader();
})();
