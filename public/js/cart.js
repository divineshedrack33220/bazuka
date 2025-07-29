// Utility Functions
const $ = (selector, context = document) => context.querySelector(selector);
const $$ = (selector, context = document) => Array.from(context.querySelectorAll(selector));
const formatPrice = (price) => `₦${Number(price).toLocaleString('en-NG')}`;
const showToast = (message) => {
  const toast = $('#notification-toast');
  $('#toast-message').textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
};
const showError = (id, message) => {
  const errorEl = $(`#${id}`);
  errorEl.textContent = message;
  errorEl.style.display = 'block';
};
const hideError = (id) => {
  const errorEl = $(`#${id}`);
  errorEl.textContent = '';
  errorEl.style.display = 'none';
};
const showLoading = (id) => $(`#${id}`).classList.add('show');
const hideLoading = (id) => $(`#${id}`).classList.remove('show');

// Cart Functions
const updateCartUI = async () => {
  try {
    const response = await fetch('/api/cart', {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    if (!response.ok) throw new Error('Failed to fetch cart');
    const cart = await response.json();
    const items = cart.items || [];
    const cartItemsEl = $('#cart-items');
    const cartEmptyEl = $('#mini-cart-empty');
    const cartCountEls = $$('#cart-count, #mobile-cart-count');
    const subtotalEl = $('#mini-cart-subtotal span:last-child');
    const totalEl = $('#mini-cart-total span:last-child');

    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    cartCountEls.forEach(el => el.textContent = totalItems);

    if (items.length === 0) {
      cartEmptyEl.style.display = 'block';
      cartItemsEl.innerHTML = '';
      subtotalEl.textContent = formatPrice(0);
      totalEl.textContent = formatPrice(0);
      return;
    }

    cartEmptyEl.style.display = 'none';
    cartItemsEl.innerHTML = items.map(item => `
      <div class="cart-item" data-id="${item.product._id}">
        <img src="${item.product.images[0] || '/placeholder.jpg'}" alt="${item.product.name}">
        <div class="cart-item-details">
          <div class="cart-item-name">${item.product.name}</div>
          <div class="cart-item-price">${formatPrice(item.product.price)}</div>
          <div class="cart-item-quantity">
            <button class="decrease-quantity">-</button>
            <input type="number" value="${item.quantity}" min="1" aria-label="Quantity">
            <button class="increase-quantity">+</button>
          </div>
        </div>
        <button class="cart-item-remove" aria-label="Remove item">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>
    `).join('');

    const subtotal = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    subtotalEl.textContent = formatPrice(subtotal);
    totalEl.textContent = formatPrice(subtotal); // Adjust for taxes/shipping if needed

    $$('.cart-item').forEach(item => {
      const id = item.dataset.id;
      const decreaseBtn = $('.decrease-quantity', item);
      const increaseBtn = $('.increase-quantity', item);
      const quantityInput = $('input', item);
      const removeBtn = $('.cart-item-remove', item);

      decreaseBtn.addEventListener('click', () => updateCartQuantity(id, quantityInput.value - 1));
      increaseBtn.addEventListener('click', () => updateCartQuantity(id, parseInt(quantityInput.value) + 1));
      quantityInput.addEventListener('change', () => updateCartQuantity(id, quantityInput.value));
      removeBtn.addEventListener('click', () => removeFromCart(id));
    });
  } catch (error) {
    console.error('Cart update error:', error);
    showToast('Failed to update cart');
  }
};

const addToCart = async (productId, quantity = 1) => {
  try {
    const response = await fetch('/api/cart/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ productId, quantity }),
    });
    if (!response.ok) throw new Error('Failed to add to cart');
    await updateCartUI();
    showToast('Item added to cart');
    $('#cart-button').classList.add('animate-ping');
    setTimeout(() => $('#cart-button').classList.remove('animate-ping'), 500);
  } catch (error) {
    console.error('Add to cart error:', error);
    showToast('Failed to add item');
  }
};

const updateCartQuantity = async (productId, quantity) => {
  quantity = parseInt(quantity);
  if (quantity < 1) return removeFromCart(productId);
  try {
    const response = await fetch('/api/cart/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ productId, quantity }),
    });
    if (!response.ok) throw new Error('Failed to update quantity');
    await updateCartUI();
    showToast('Cart updated');
  } catch (error) {
    console.error('Update quantity error:', error);
    showToast('Failed to update cart');
  }
};

const removeFromCart = async (productId) => {
  try {
    const response = await fetch('/api/cart/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ productId }),
    });
    if (!response.ok) throw new Error('Failed to remove item');
    await updateCartUI();
    showToast('Item removed from cart');
  } catch (error) {
    console.error('Remove from cart error:', error);
    showToast('Failed to remove item');
  }
};

// Product Modal
const showProductModal = (product) => {
  const modal = $('#product-modal');
  const carousel = $('#carousel');
  const dotsContainer = $('#carousel-dots');
  const details = $('#modal-product-details');
  const images = product.images || ['/placeholder.jpg'];

  carousel.innerHTML = images.map(img => `<img src="${img}" alt="${product.name}">`).join('');
  carousel.style.width = `${images.length * 100}%`;
  dotsContainer.innerHTML = images.map((_, i) => `<span class="carousel-dot ${i === 0 ? 'active' : ''}"></span>`).join('');
  details.innerHTML = `
    <h2 class="modal-product-name">${product.name}</h2>
    <div class="modal-product-price">
      ${formatPrice(product.price)}
      ${product.oldPrice ? `<span class="old-price">${formatPrice(product.oldPrice)}</span>` : ''}
    </div>
    <div class="modal-product-description">${product.description || 'No description available'}</div>
    <div class="modal-actions">
      <button class="add-to-cart" data-id="${product._id}">
        Add to Cart
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2zm-8.9-5h7.45c.75 0 1.41-.41 1.75-1.03l3.86-7.01L19.42 4h-.01l-1.1 2-2.76 5H8.53l-.13-.27L6.16 6l-.95-2-.94-2H1v2h2l3.6 7.59L5.25 14c-.16.33-.25.71-.25 1.1 0 1.1.9 2 2 2h12v-2H7.42c-.13 0-.25-.11-.25-.25z"/></svg>
      </button>
    </div>
  `;

  let currentSlide = 0;
  const updateCarousel = () => {
    carousel.style.transform = `translateX(-${(currentSlide * 100) / images.length}%)`;
    $$('.carousel-dot').forEach((dot, i) => dot.classList.toggle('active', i === currentSlide));
    $('#carousel-prev').disabled = currentSlide === 0;
    $('#carousel-next').disabled = currentSlide === images.length - 1;
  };

  $('#carousel-prev').onclick = () => { if (currentSlide > 0) { currentSlide--; updateCarousel(); } };
  $('#carousel-next').onclick = () => { if (currentSlide < images.length - 1) { currentSlide++; updateCarousel(); } };
  $$('.carousel-dot').forEach((dot, i) => dot.onclick = () => { currentSlide = i; updateCarousel(); });

  $('.add-to-cart', details).onclick = () => addToCart(product._id);
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  updateCarousel();
};

const closeProductModal = () => {
  const modal = $('#product-modal');
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
};

// Fetch Products
async function loadProducts() {
  try {
    showLoading('products-loading');
    hideError('products-error');
    const res = await fetch('/api/products?limit=8');
    if (!res.ok) throw new Error('Failed to fetch products');
    const products = await res.json();
    const productGrid = $('#product-grid');
    productGrid.innerHTML = products.map(product => `
      <div class="product-card" role="listitem">
        <div class="product-image-container">
          <img src="${product.images ? product.images[0] : '/placeholder.jpg'}" alt="${product.name}" class="product-image" loading="lazy">
          ${product.isFeatured ? '<span class="product-badge bestseller">Featured</span>' : ''}
          ${product.oldPrice ? '<span class="product-badge sale">Sale</span>' : ''}
        </div>
        <div class="product-details">
          <div class="product-header">
            <div class="product-name">${product.name}</div>
            <div class="product-price">
              ${formatPrice(product.price)}
              ${product.oldPrice ? `<span class="old-price">${formatPrice(product.oldPrice)}</span>` : ''}
            </div>
          </div>
          <div class="product-rating">
            ${'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>'.repeat(Math.floor(product.rating || 5))}
            ${product.rating % 1 !== 0 ? `
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="clip-path: url(#half-star);"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
              <clipPath id="half-star"><rect x="0" y="0" width="12" height="24"/></clipPath>
            ` : ''}
          </div>
          <div class="product-description">${product.description.slice(0, 60)}...</div>
          <button class="add-to-cart" data-id="${product._id}">
            Add to Cart
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2zm-8.9-5h7.45c.75 0 1.41-.41 1.75-1.03l3.86-7.01L19.42 4h-.01l-1.1 2-2.76 5H8.53l-.13-.27L6.16 6l-.95-2-.94-2H1v2h2l3.6 7.59L5.25 14c-.16.33-.25.71-.25 1.1 0 1.1.9 2 2 2h12v-2H7.42c-.13 0-.25-.11-.25-.25z"/></svg>
          </button>
          <button class="view-details" data-id="${product._id}">View Details</button>
        </div>
      </div>
    `).join('');

    $$('.add-to-cart').forEach(btn => btn.onclick = () => addToCart(btn.dataset.id));
    $$('.view-details').forEach(btn => btn.onclick = async () => {
      try {
        const response = await fetch(`/api/products/${btn.dataset.id}`);
        if (!response.ok) throw new Error('Failed to fetch product');
        const product = await response.json();
        showProductModal(product);
      } catch (error) {
        console.error('Fetch product error:', error);
        showToast('Failed to load product details');
      }
    });
  } catch (error) {
    console.error('Error loading products:', error);
    showError('products-error', 'Failed to load products. Please try again.');
  } finally {
    hideLoading('products-loading');
  }
}

// Fetch Categories
async function loadCategories() {
  try {
    showLoading('categories-loading');
    hideError('categories-error');
    const res = await fetch('/api/categories');
    if (!res.ok) throw new Error('Failed to fetch categories');
    const categories = await res.json();
    $('#categories-grid').innerHTML = categories.map(category => `
      <div class="category-card">
        <img src="${category.image || '/placeholder.jpg'}" alt="${category.name}" class="category-image" loading="lazy">
        <div class="category-overlay">
          <div class="category-content">
            <h3 class="category-title">${category.name}</h3>
            <a href="/products?category=${category._id}" class="category-link">Shop Now
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
            </a>
          </div>
        </div>
        <span class="category-badge">${category.productCount || 0} Items</span>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading categories:', error);
    showError('categories-error', 'Failed to load categories. Please try again.');
  } finally {
    hideLoading('categories-loading');
  }
}

// Fetch Testimonials
async function loadTestimonials() {
  try {
    showLoading('testimonials-loading');
    hideError('testimonials-error');
    const res = await fetch('/api/testimonials');
    if (!res.ok) throw new Error('Failed to fetch testimonials');
    const testimonials = await res.json();
    $('#testimonials-grid').innerHTML = testimonials.map(testimonial => `
      <div class="testimonial-card">
        <div class="testimonial-header">
          <img src="${testimonial.image || '/placeholder.jpg'}" alt="${testimonial.name}" class="testimonial-image" loading="lazy">
          <div>
            <div class="testimonial-name">${testimonial.name}</div>
            <div class="testimonial-rating">
              ${'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>'.repeat(Math.floor(testimonial.rating || 5))}
              ${testimonial.rating % 1 !== 0 ? `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="clip-path: url(#half-star);"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                <clipPath id="half-star"><rect x="0" y="0" width="12" height="24"/></clipPath>
              ` : ''}
            </div>
          </div>
        </div>
        <p class="testimonial-text">"${testimonial.text}"</p>
        <div class="testimonial-verified">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
          Verified Purchase
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading testimonials:', error);
    showError('testimonials-error', 'Failed to load testimonials. Please try again.');
  } finally {
    hideLoading('testimonials-loading');
  }
}

// Fetch Promos
async function loadPromos() {
  try {
    const res = await fetch('/api/promos');
    if (!res.ok) throw new Error('Failed to fetch promos');
    const promos = await res.json();
    const promoContainer = $('#promo-container') || $('.benefits-container'); // Fallback to benefits-container
    if (!promoContainer) return; // Skip if container doesn't exist
    promoContainer.innerHTML = promos.map(promo => `
      <div class="benefit-item">
        <span class="benefit-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${promo.iconPath || 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 0'}"></path></svg>
        </span>
        <div class="benefit-text">
          <h3>${promo.title}</h3>
          <p>${promo.description}</p>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading promos:', error);
    if ($('#promo-container')) {
      $('#promo-container').innerHTML = '<p>Failed to load promotions.</p>';
    }
  }
}

// Newsletter Subscription
const handleNewsletterSubmit = async (e) => {
  e.preventDefault();
  const form = $('#newsletter-form');
  const email = $('.newsletter-input[type="email"]', form).value;
  const name = $('.newsletter-name', form)?.value || '';
  try {
    const response = await fetch('/api/newsletter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name }),
    });
    if (!response.ok) throw new Error('Failed to subscribe');
    showToast('Subscribed successfully!');
    form.reset();
  } catch (error) {
    console.error('Newsletter error:', error);
    showToast('Failed to subscribe. Please try again.');
  }
};

// Event Listeners
document.addEventListener('DOMContentLoaded', async () => {
  // Navigation
  const nav = $('.nav-container');
  const mobileMenuBtn = $('#mobile-menu-button');
  const mobileMenu = $('#mobile-menu');
  const cartBtn = $('#cart-button');
  const miniCart = $('#mini-cart');
  const miniCartClose = $('#mini-cart-close');
  const miniCartOverlay = $('#mini-cart-overlay');
  const backToTop = $('#back-to-top');
  const modalClose = $('#modal-close');

  // Scroll effects
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 50);
    backToTop.classList.toggle('show', window.scrollY > 500);
  });

  // Mobile menu toggle
  mobileMenuBtn.onclick = () => mobileMenu.classList.toggle('show');
  $$('#mobile-menu a').forEach(link => link.onclick = () => mobileMenu.classList.remove('show'));

  // Cart toggle
  cartBtn.onclick = () => {
    miniCart.classList.add('show');
    miniCartOverlay.classList.add('show');
    updateCartUI();
  };
  miniCartClose.onclick = () => {
    miniCart.classList.remove('show');
    miniCartOverlay.classList.remove('show');
  };
  miniCartOverlay.onclick = () => {
    miniCart.classList.remove('show');
    miniCartOverlay.classList.remove('show');
  };

  // Modal close
  modalClose.onclick = closeProductModal;

  // Newsletter form
  $('#newsletter-form').onsubmit = handleNewsletterSubmit;

  // Back to top
  backToTop.onclick = (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Initialize data
  await Promise.all([
    loadProducts(),
    loadCategories(),
    loadTestimonials(),
    loadPromos(),
    updateCartUI(),
  ]);
});