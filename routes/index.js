document.addEventListener('DOMContentLoaded', async () => {
  const productGrid = document.getElementById('product-grid');
  const categoriesGrid = document.getElementById('categories-grid');
  const testimonialsGrid = document.getElementById('testimonials-grid');
  const promoContainer = document.getElementById('promo-container');
  const cartCount = document.getElementById('cart-count');
  const mobileCartCount = document.getElementById('mobile-cart-count');
  const newsletterForm = document.getElementById('newsletter-form');

  // Fetch Products
  async function loadProducts() {
    try {
      const res = await fetch('/api/products');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const products = await res.json();
      productGrid.innerHTML = '';
      if (products.length === 0) {
        productGrid.innerHTML = '<p>No products available.</p>';
        return;
      }
      products.forEach(product => {
        const card = document.createElement('div');
        card.className = 'product-card';
        card.innerHTML = `
          <div class="product-image-container">
            <img src="${product.image}" alt="${product.name}" class="product-image">
            ${product.isFeatured ? '<span class="product-badge bestseller">Featured</span>' : ''}
          </div>
          <div class="product-details">
            <div class="product-header">
              <h3 class="product-name">${product.name}</h3>
              <div class="product-price">
                ₦${product.price.toLocaleString('en-NG', { minimumFractionDigits: 2 })}
                ${product.oldPrice ? `<span class="old-price">₦${product.oldPrice.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</span>` : ''}
              </div>
            </div>
            <p class="product-description">${product.description}</p>
            <button class="add-to-cart" data-id="${product._id}" aria-label="Add ${product.name} to cart">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2zm-8.9-5h7.45c.75 0 1.41-.41 1.75-1.03l3.86-7.01L19.42 4h-.01l-1.1 2-2.76 5H8.53l-.13-.27L6.16 6l-.95-2-.94-2H1v2h2l3.6 7.59L5.25 14c-.16.33-.25.71-.25 1.1 0 1.1.9 2 2 2h12v-2H7.42c-.13 0-.25-.11-.25-.25z"/></svg>
              Add to Cart
            </button>
          </div>
        `;
        productGrid.appendChild(card);
      });
    } catch (error) {
      console.error('Error loading products:', error);
      productGrid.innerHTML = '<p>Failed to load products. Please try again later.</p>';
    }
  }

  // Fetch Categories
  async function loadCategories() {
    try {
      const res = await fetch('/api/categories');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const categories = await res.json();
      categoriesGrid.innerHTML = '';
      if (categories.length === 0) {
        categoriesGrid.innerHTML = '<p>No categories available.</p>';
        return;
      }
      categories.forEach(category => {
        const card = document.createElement('div');
        card.className = 'category-card';
        card.innerHTML = `
          <img src="${category.image}" alt="${category.name}" class="category-image">
          <div class="category-overlay">
            <div class="category-content">
              <h3 class="category-title">${category.name}</h3>
              <a href="/products?category=${category._id}" class="category-link" aria-label="Shop ${category.name}">Shop Now
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
              </a>
            </div>
          </div>
        `;
        categoriesGrid.appendChild(card);
      });
    } catch (error) {
      console.error('Error loading categories:', error);
      categoriesGrid.innerHTML = '<p>Failed to load categories. Please try again later.</p>';
    }
  }

  // Fetch Testimonials
  async function loadTestimonials() {
    try {
      const res = await fetch('/api/testimonials');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const testimonials = await res.json();
      testimonialsGrid.innerHTML = '';
      if (testimonials.length === 0) {
        testimonialsGrid.innerHTML = '<p>No testimonials available.</p>';
        return;
      }
      testimonials.forEach(testimonial => {
        const card = document.createElement('div');
        card.className = 'testimonial-card';
        card.innerHTML = `
          <div class="testimonial-header">
            <div class="testimonial-avatar">
              <img src="${testimonial.image}" alt="${testimonial.name}">
            </div>
            <div>
              <h4 class="testimonial-name">${testimonial.name}</h4>
              <div class="testimonial-rating">
                ${Array(Math.floor(testimonial.rating)).fill().map(() => `
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                `).join('')}
                ${testimonial.rating % 1 !== 0 ? `
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path clip-path="url(#half)" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/><clipPath id="half"><rect x="0" y="0" width="12" height="24"/></clipPath></svg>
                ` : ''}
              </div>
            </div>
          </div>
          <p class="testimonial-text">"${testimonial.text}"</p>
        `;
        testimonialsGrid.appendChild(card);
      });
    } catch (error) {
      console.error('Error loading testimonials:', error);
      testimonialsGrid.innerHTML = '<p>Failed to load testimonials. Please try again later.</p>';
    }
  }

  // Fetch Promos
  async function loadPromos() {
    try {
      const res = await fetch('/api/promos');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const promos = await res.json();
      promoContainer.innerHTML = '';
      if (promos.length === 0) {
        promoContainer.innerHTML = '<p>No promotions available.</p>';
        return;
      }
      promos.forEach(promo => {
        const item = document.createElement('div');
        item.className = 'promo-item';
        item.innerHTML = `
          <div class="promo-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${promo.iconPath}" /></svg>
          </div>
          <div class="promo-text">
            <h3>${promo.title}</h3>
            <p>${promo.description}</p>
          </div>
        `;
        promoContainer.appendChild(item);
      });
    } catch (error) {
      console.error('Error loading promos:', error);
      promoContainer.innerHTML = '<p>Failed to load promotions. Please try again later.</p>';
    }
  }

  // Update Cart Count
  async function updateCartCount() {
    try {
      const res = await fetch('/api/cart');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const cart = await res.json();
      const count = cart.items ? cart.items.reduce((sum, item) => sum + item.quantity, 0) : 0;
      cartCount.textContent = count;
      mobileCartCount.textContent = count;
    } catch (error) {
      console.error('Error updating cart count:', error);
      cartCount.textContent = '0';
      mobileCartCount.textContent = '0';
    }
  }

  // Add to Cart
  productGrid.addEventListener('click', async (e) => {
    const button = e.target.closest('.add-to-cart');
    if (button) {
      button.disabled = true;
      const productId = button.dataset.id;
      try {
        const res = await fetch('/api/cart/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId, quantity: 1 }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await updateCartCount();
        button.classList.add('animate-ping');
        setTimeout(() => button.classList.remove('animate-ping'), 500);
      } catch (error) {
        console.error('Error adding to cart:', error);
        alert('Failed to add to cart. Please try again.');
      } finally {
        button.disabled = false;
      }
    }
  });

  // Newsletter Subscription
  if (newsletterForm) {
    newsletterForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailInput = newsletterForm.querySelector('input');
      const email = emailInput.value.trim();
      if (!email) {
        alert('Please enter a valid email.');
        return;
      }
      try {
        const res = await fetch('/api/newsletter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (!res.ok) {
          const { error } = await res.json();
          throw new Error(error || `HTTP ${res.status}`);
        }
        alert('Subscribed successfully!');
        newsletterForm.reset();
      } catch (error) {
        console.error('Error subscribing:', error);
        alert(error.message === 'Email already subscribed' ? 'This email is already subscribed.' : 'Failed to subscribe. Please try again.');
      }
    });
  }

  // Initialize
  try {
    await Promise.all([
      loadProducts(),
      loadCategories(),
      loadTestimonials(),
      loadPromos(),
      updateCartCount(),
    ]);
  } catch (error) {
    console.error('Initialization error:', error);
  }
});