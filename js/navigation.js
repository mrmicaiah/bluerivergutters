/**
 * Blue River Gutters - Navigation JavaScript
 * Handles dropdown menus and mobile accordion navigation
 */

document.addEventListener('DOMContentLoaded', function() {
  
  // Mobile Menu Toggle
  const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
  const mobileNav = document.querySelector('.mobile-nav');
  
  if (mobileMenuBtn && mobileNav) {
    mobileMenuBtn.addEventListener('click', function() {
      this.classList.toggle('active');
      mobileNav.classList.toggle('active');
      
      // Update aria-expanded
      const isExpanded = this.classList.contains('active');
      this.setAttribute('aria-expanded', isExpanded);
    });
  }
  
  // Desktop Dropdown - keyboard accessibility
  const dropdowns = document.querySelectorAll('.nav-dropdown');
  
  dropdowns.forEach(dropdown => {
    const toggle = dropdown.querySelector('.nav-dropdown-toggle');
    const menu = dropdown.querySelector('.nav-dropdown-menu');
    
    if (toggle && menu) {
      // Toggle on click for touch devices
      toggle.addEventListener('click', function(e) {
        e.preventDefault();
        const isActive = dropdown.classList.contains('active');
        
        // Close all other dropdowns
        dropdowns.forEach(d => d.classList.remove('active'));
        
        // Toggle this one
        if (!isActive) {
          dropdown.classList.add('active');
          toggle.setAttribute('aria-expanded', 'true');
        } else {
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
      
      // Keyboard navigation
      toggle.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle.click();
        }
        if (e.key === 'Escape') {
          dropdown.classList.remove('active');
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    }
  });
  
  // Close dropdowns when clicking outside
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.nav-dropdown')) {
      dropdowns.forEach(dropdown => {
        dropdown.classList.remove('active');
        const toggle = dropdown.querySelector('.nav-dropdown-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      });
    }
  });
  
  // Mobile Accordion
  const accordions = document.querySelectorAll('.mobile-accordion');
  
  accordions.forEach(accordion => {
    const toggle = accordion.querySelector('.mobile-accordion-toggle');
    
    if (toggle) {
      toggle.addEventListener('click', function() {
        const isActive = accordion.classList.contains('active');
        
        // Close all accordions
        accordions.forEach(a => {
          a.classList.remove('active');
          const t = a.querySelector('.mobile-accordion-toggle');
          if (t) t.setAttribute('aria-expanded', 'false');
        });
        
        // Toggle this one
        if (!isActive) {
          accordion.classList.add('active');
          toggle.setAttribute('aria-expanded', 'true');
        }
      });
    }
  });
  
  // Close mobile menu on link click
  const mobileLinks = document.querySelectorAll('.mobile-nav a:not(.mobile-accordion-toggle)');
  mobileLinks.forEach(link => {
    link.addEventListener('click', function() {
      if (mobileMenuBtn && mobileNav) {
        mobileMenuBtn.classList.remove('active');
        mobileNav.classList.remove('active');
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
      }
    });
  });
  
});
