// ==========================================
// FIREBASE CONFIGURATION & INITIALIZATION
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyAWhc-WVX1fhvynA9VqFqp3bqiYWdmwRZ4",
    authDomain: "lillex-store.firebaseapp.com",
    projectId: "lillex-store",
    storageBucket: "lillex-store.firebasestorage.app",
    messagingSenderId: "444374376657",
    appId: "1:444374376657:web:e859ec0573407f94e165f0"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();

// ==========================================
// ADMIN EMAIL — hardcoded check
// ==========================================
const ADMIN_EMAIL = "obelilian52@gmail.com";

// ==========================================
// STATE
// ==========================================
const categoriesList = ["S Series", "Note Series", "Fold & Flip", "iPhone Pro", "iPhone Standard"];
let activeFilters = [...categoriesList];
let selectedStorageMap = {};
let transientProofOfPaymentBase64 = "";
let activePriceEditId = null;
let activeDeleteTargetId = null;
let activeProductImageRowTargetId = null;
let currentSortMode = "default";
let searchQuery = "";
let authFormIsSignUpMode = false;
let currentUser = null;          // Firebase user object
let currentUserProfile = null;   // Firestore profile doc
let currentActiveCart = JSON.parse(localStorage.getItem('lillex_active_cart')) || [];

// ==========================================
// BOOT
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    initCategoryFiltersUI();
    setupAllEventListeners();
    setupDashboardTabs('#customerDashboardSection');
    setupDashboardTabs('#adminSection');
    setupPaymentMethodToggle();
    setupFileUploadZones();
    setupSearchListeners();
    document.getElementById('sortSelect').addEventListener('change', (e) => {
        currentSortMode = e.target.value;
        renderCatalogLayout();
    });
    updateCartIconBadge();
});

// ==========================================
// FIREBASE AUTH STATE LISTENER
// ==========================================
auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        const ref = db.collection('users').doc(user.uid);
        const snap = await ref.get();
        if (snap.exists) {
            currentUserProfile = snap.data();
        } else {
            currentUserProfile = {
                name: user.displayName || "New User",
                email: user.email,
                phone: "",
                address: "",
                isAdmin: user.email === ADMIN_EMAIL,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            await ref.set(currentUserProfile);
        }
        syncUserSessionDOM();
        updateCartIconBadge();

        // Always route to store when auth state confirms login
        const authSection = document.getElementById('authSection');
        if (!authSection.classList.contains('hidden')) {
            routeToStore();
        }

        // If Google user with no address, show completion modal
        if (user.providerData[0]?.providerId === 'google.com' && (!currentUserProfile.phone || !currentUserProfile.address)) {
            showCompleteProfileModal();
        }
    } else {
        currentUser = null;
        currentUserProfile = null;
        syncUserSessionDOM();
    }
    loadProductsFromFirestore();
});

// ==========================================
// FIRESTORE — PRODUCTS
// ==========================================
async function loadProductsFromFirestore() {
    const grid = document.getElementById('productsGrid');

    try {
        const snap = await db.collection('products').get();
        if (snap.empty) {
            // Seed default products on first run
            await seedDefaultProducts();
            return loadProductsFromFirestore();
        }
        let products = [];
        snap.forEach(doc => products.push({ id: doc.id, ...doc.data() }));
        renderCatalogLayout(products);
    } catch (err) {
        // Firestore not ready / offline fallback
        renderCatalogLayout(getLocalFallbackProducts());
    }
}

function getLocalFallbackProducts() {
    return JSON.parse(localStorage.getItem('lillex_products_cache')) || [];
}

async function seedDefaultProducts() {
    const defaults = [
        { baseName: "Samsung Galaxy S24 Ultra", series: "S Series", basePrice: 1950000, desc: "Ultimate Galaxy with S Pen and Pro-grade AI optics.", inStock: true, imageAsset: "", createdAt: firebase.firestore.FieldValue.serverTimestamp() },
        { baseName: "Samsung Galaxy S24+", series: "S Series", basePrice: 1450000, desc: "Striking balance of performance and beautiful display.", inStock: true, imageAsset: "", createdAt: firebase.firestore.FieldValue.serverTimestamp() },
        { baseName: "Samsung Galaxy Z Fold 5", series: "Fold & Flip", basePrice: 2600000, desc: "Massive cinematic display that redefines productivity.", inStock: true, imageAsset: "", createdAt: firebase.firestore.FieldValue.serverTimestamp() },
        { baseName: "Samsung Galaxy Z Flip 5", series: "Fold & Flip", basePrice: 1350000, desc: "Compact, pocketable, and full of personality.", inStock: true, imageAsset: "", createdAt: firebase.firestore.FieldValue.serverTimestamp() }
    ];
    const batch = db.batch();
    defaults.forEach(p => {
        const ref = db.collection('products').doc();
        batch.set(ref, p);
    });
    await batch.commit();
}

// ==========================================
// CATALOG RENDER
// ==========================================
function renderCatalogLayout(products) {
    const grid = document.getElementById('productsGrid');
    const countEl = document.getElementById('productsCount');
    if (!grid) return;

    if (!products) {
        loadProductsFromFirestore();
        return;
    }

    // Cache locally
    localStorage.setItem('lillex_products_cache', JSON.stringify(products));

    let filtered = products.filter(d => activeFilters.includes(d.series));
    if (searchQuery) {
        filtered = filtered.filter(d =>
            d.baseName.toLowerCase().includes(searchQuery) ||
            d.series.toLowerCase().includes(searchQuery) ||
            (d.desc || '').toLowerCase().includes(searchQuery)
        );
    }
    if (currentSortMode === 'price-asc') filtered.sort((a, b) => a.basePrice - b.basePrice);
    else if (currentSortMode === 'price-desc') filtered.sort((a, b) => b.basePrice - a.basePrice);
    else if (currentSortMode === 'name-asc') filtered.sort((a, b) => a.baseName.localeCompare(b.baseName));

    if (countEl) countEl.textContent = `${filtered.length} product${filtered.length !== 1 ? 's' : ''}`;

    grid.innerHTML = "";
    if (filtered.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--muted);">No products found.</div>`;
        return;
    }

    filtered.forEach(item => {
        if (!selectedStorageMap[item.id]) selectedStorageMap[item.id] = "256GB";
        const size = selectedStorageMap[item.id];
        const price = calcPrice(item.basePrice, size);
        const imgEl = item.imageAsset
            ? `<img src="${item.imageAsset}" alt="${item.baseName}" loading="lazy">`
            : `<div class="product-fallback-icon"><i class="fa-solid fa-mobile-screen-button"></i></div>`;
        const buyBtn = item.inStock
            ? `<button class="solid-btn buy-btn" data-id="${item.id}"><i class="fa-solid fa-bag-shopping"></i> Add</button>`
            : `<button class="solid-btn buy-btn" disabled>Out of Stock</button>`;

        grid.insertAdjacentHTML('beforeend', `
            <div class="product-card${!item.inStock ? ' out-of-stock' : ''}">
                <div class="product-img-frame">
                    ${imgEl}
                    <span class="product-badge">${item.series}</span>
                </div>
                <div class="product-info-panel">
                    <h3 class="product-card-title">${item.baseName}</h3>
                    <p class="product-card-desc">${item.desc || 'Premium Samsung device.'}</p>
                    <div class="storage-options">
                        ${['64GB','256GB','1TB'].map(s => `<button class="stor-opt-btn${size===s?' active':''}" data-id="${item.id}" data-size="${s}">${s}</button>`).join('')}
                    </div>
                    <div class="product-card-footer">
                        <span class="product-price">₦${price.toLocaleString()}</span>
                        ${buyBtn}
                    </div>
                </div>
            </div>
        `);
    });

    grid.querySelectorAll('.stor-opt-btn').forEach(b => b.addEventListener('click', (e) => {
        selectedStorageMap[e.target.dataset.id] = e.target.dataset.size;
        renderCatalogLayout(getLocalFallbackProducts());
    }));
    grid.querySelectorAll('.buy-btn:not([disabled])').forEach(b => b.addEventListener('click', (e) => {
        attemptAddToCart(e.currentTarget.dataset.id);
    }));
}

function calcPrice(base, size) {
    if (size === "64GB") return base - 120000;
    if (size === "1TB") return base + 350000;
    return base;
}

// ==========================================
// AUTH EVENTS
// ==========================================
function setupAllEventListeners() {
    document.getElementById('navLogo').addEventListener('click', routeToStore);
    document.getElementById('authNavBtnGuest').addEventListener('click', showAuthPage);
    document.getElementById('authNavBtn').addEventListener('click', handleAvatarClick);
    document.getElementById('globalLogoutBtn').addEventListener('click', handleLogout);

    // Auth tabs
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            authFormIsSignUpMode = tab.dataset.tab === 'register';
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            syncAuthFormFields();
        });
    });

    document.getElementById('authForm').addEventListener('submit', handleEmailAuth);
    document.getElementById('googleSignInBtn').addEventListener('click', handleGoogleSignIn);

    document.getElementById('pwToggleBtn').addEventListener('click', () => {
        const pw = document.getElementById('authPassword');
        const icon = document.querySelector('#pwToggleBtn i');
        pw.type = pw.type === 'password' ? 'text' : 'password';
        icon.className = pw.type === 'password' ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
    });

    // Complete profile modal
    document.getElementById('saveCompleteProfileBtn').addEventListener('click', saveCompleteProfile);

    // Cart
    document.getElementById('cartIcon').addEventListener('click', openCart);
    document.getElementById('closeCartBtn').addEventListener('click', closeCart);
    document.getElementById('cartBackdrop').addEventListener('click', closeCart);
    document.getElementById('checkoutBtn').addEventListener('click', launchCheckout);

    // Checkout
    document.getElementById('cancelCheckoutBtn').addEventListener('click', routeToStore);
    document.getElementById('orderCheckoutFinalForm').addEventListener('submit', submitOrder);
    document.getElementById('closeSuccessSplashBtn').addEventListener('click', () => {
        document.getElementById('successSplashModal').classList.add('hidden');
        routeToStore();
    });
    document.getElementById('copyAccBtn').addEventListener('click', () => {
        navigator.clipboard.writeText('3012345678').then(() => toast("Account number copied!"));
    });

    // Back buttons
    document.getElementById('backToStoreFromDashBtn').addEventListener('click', routeToStore);
    document.getElementById('backToStoreFromAdminBtn').addEventListener('click', routeToStore);

    // Admin
    document.getElementById('productManageForm').addEventListener('submit', adminAddProduct);

    // Modals
    document.getElementById('cancelPriceModalBtn').addEventListener('click', () => document.getElementById('priceEditModal').classList.add('hidden'));
    document.getElementById('savePriceModalBtn').addEventListener('click', adminSavePrice);
    document.getElementById('cancelDeleteModalBtn').addEventListener('click', () => document.getElementById('deleteConfirmModal').classList.add('hidden'));
    document.getElementById('confirmDeleteModalBtn').addEventListener('click', adminDeleteProduct);
    document.getElementById('inventoryRowImageFileTrigger').addEventListener('change', adminUpdateRowImage);

    // Mobile sidebar
    document.getElementById('mobileFilterBtn').addEventListener('click', () => document.getElementById('sidebarDrawer').classList.add('open'));
    document.getElementById('sidebarCloseBtn').addEventListener('click', () => document.getElementById('sidebarDrawer').classList.remove('open'));
    document.getElementById('sidebarOverlay').addEventListener('click', () => document.getElementById('sidebarDrawer').classList.remove('open'));
}

// ==========================================
// GOOGLE SIGN IN
// ==========================================
async function handleGoogleSignIn() {
    try {
        document.getElementById('googleSignInBtn').innerHTML = `<div class="btn-spinner"></div> Signing in...`;
        await auth.signInWithPopup(googleProvider);
        // onAuthStateChanged handles the rest
    } catch (err) {
        showAuthError(err.message);
        document.getElementById('googleSignInBtn').innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Continue with Google`;
    }
}

// ==========================================
// EMAIL/PASSWORD AUTH
// ==========================================
async function handleEmailAuth(e) {
    e.preventDefault();
    const email = document.getElementById('authEmail').value.trim().toLowerCase();
    const password = document.getElementById('authPassword').value;
    const btn = document.getElementById('authSubmitBtn');
    btn.textContent = 'Please wait...';
    btn.disabled = true;

    try {
        if (authFormIsSignUpMode) {
            const name = document.getElementById('authName').value.trim();
            const phone = document.getElementById('authPhone').value.trim();
            const address = document.getElementById('authAddress').value.trim();
            if (!name || !phone || !address) { showAuthError("Please fill all fields."); btn.textContent = 'Create Account'; btn.disabled = false; return; }

            const cred = await auth.createUserWithEmailAndPassword(email, password);
            await cred.user.updateProfile({ displayName: name });

            // Save extra profile to Firestore
            await db.collection('users').doc(cred.user.uid).set({
                name, phone, address, email,
                isAdmin: email === ADMIN_EMAIL,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            toast(`Welcome, ${name.split(' ')[0]}!`);
        } else {
            await auth.signInWithEmailAndPassword(email, password);
            toast(`Welcome back!`);
        }
        document.getElementById('authForm').reset();
        routeToStore();
    } catch (err) {
        let msg = "Something went wrong. Try again.";
        if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') msg = "Invalid email or password.";
        if (err.code === 'auth/email-already-in-use') msg = "An account with this email already exists.";
        if (err.code === 'auth/weak-password') msg = "Password must be at least 6 characters.";
        if (err.code === 'auth/invalid-email') msg = "Please enter a valid email address.";
        showAuthError(msg);
    }
    btn.textContent = authFormIsSignUpMode ? 'Create Account' : 'Sign In';
    btn.disabled = false;
}

async function handleLogout() {
    await auth.signOut();
    currentActiveCart = [];
    localStorage.removeItem('lillex_active_cart');
    updateCartIconBadge();
    toast("Signed out successfully.");
    routeToStore();
}

// ==========================================
// COMPLETE PROFILE MODAL (Google users)
// ==========================================
function showCompleteProfileModal() {
    document.getElementById('completeProfileModal').classList.remove('hidden');
}

async function saveCompleteProfile() {
    const phone = document.getElementById('completePhone').value.trim();
    const address = document.getElementById('completeAddress').value.trim();
    const errEl = document.getElementById('completeProfileError');

    if (!phone || !address) {
        errEl.textContent = "Please fill in both fields.";
        errEl.classList.remove('hidden');
        return;
    }
    try {
        await db.collection('users').doc(currentUser.uid).update({ phone, address });
        currentUserProfile.phone = phone;
        currentUserProfile.address = address;
        document.getElementById('completeProfileModal').classList.add('hidden');
        toast("Profile saved! You can now shop freely.");
    } catch (err) {
        errEl.textContent = "Failed to save. Try again.";
        errEl.classList.remove('hidden');
    }
}

// ==========================================
// NAV / ROUTING
// ==========================================
function routeToStore() {
    ['authSection','customerDashboardSection','adminSection','checkoutFormSection'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    document.getElementById('trustBanner').classList.remove('hidden');
    document.getElementById('storeSection').classList.remove('hidden');
    loadProductsFromFirestore();
}

function showAuthPage() {
    document.getElementById('storeSection').classList.add('hidden');
    document.getElementById('trustBanner').classList.add('hidden');
    document.getElementById('authSection').classList.remove('hidden');
}

function handleAvatarClick() {
    if (!currentUser) return;
    document.getElementById('storeSection').classList.add('hidden');
    document.getElementById('trustBanner').classList.add('hidden');
    if (currentUserProfile?.isAdmin) {
        document.getElementById('adminSection').classList.remove('hidden');
        adminLoadInventory();
        adminLoadOrders();
    } else {
        document.getElementById('customerDashboardSection').classList.remove('hidden');
        renderCustomerDashboard();
    }
}

function syncUserSessionDOM() {
    const welcome = document.getElementById('userWelcome');
    const guestBtn = document.getElementById('authNavBtnGuest');
    const logoutBtn = document.getElementById('globalLogoutBtn');
    const nameDisplay = document.getElementById('userNameDisplay');

    if (currentUser && currentUserProfile) {
        welcome.classList.remove('hidden');
        guestBtn.classList.add('hidden');
        logoutBtn.classList.remove('hidden');
        nameDisplay.textContent = (currentUserProfile.name || currentUser.displayName || 'User').split(' ')[0];
    } else {
        welcome.classList.add('hidden');
        guestBtn.classList.remove('hidden');
        logoutBtn.classList.add('hidden');
    }
}

function syncAuthFormFields() {
    ['nameField','phoneField','addressField'].forEach(id => {
        document.getElementById(id).classList.toggle('hidden', !authFormIsSignUpMode);
    });
    document.getElementById('authSubmitBtn').textContent = authFormIsSignUpMode ? 'Create Account' : 'Sign In';
    document.getElementById('authPassword').required = true;
}

// ==========================================
// FILTERS
// ==========================================
function initCategoryFiltersUI() {
    const wrapper = document.getElementById('filterSectionWrapper');
    if (!wrapper) return;
    categoriesList.forEach(cat => {
        wrapper.insertAdjacentHTML('beforeend', `
            <div class="filter-item">
                <input type="checkbox" id="filter-${cat.replace(/\s+/g,'')}" checked value="${cat}">
                <label for="filter-${cat.replace(/\s+/g,'')}"> ${cat}</label>
            </div>
        `);
    });
    wrapper.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
            activeFilters = Array.from(wrapper.querySelectorAll('input:checked')).map(c => c.value);
            renderCatalogLayout(getLocalFallbackProducts());
            updateFilterChips();
            document.getElementById('sidebarDrawer').classList.remove('open');
        });
    });
    updateFilterChips();
}

function updateFilterChips() {
    const container = document.getElementById('activeFilterChips');
    if (!container) return;
    container.innerHTML = activeFilters.map(f => `<span class="filter-chip">${f}</span>`).join('');
}

function setupSearchListeners() {
    const handler = (e) => {
        searchQuery = e.target.value.toLowerCase();
        document.getElementById('searchInput').value = e.target.value;
        document.getElementById('mobileSearchInput').value = e.target.value;
        renderCatalogLayout(getLocalFallbackProducts());
    };
    document.getElementById('searchInput').addEventListener('input', handler);
    document.getElementById('mobileSearchInput').addEventListener('input', handler);
}

// ==========================================
// CART
// ==========================================
function openCart() { document.getElementById('cartOverlay').classList.remove('hidden'); renderCartList(); }
function closeCart() { document.getElementById('cartOverlay').classList.add('hidden'); }

function attemptAddToCart(productId) {
    if (!currentUser) {
        toast("Please sign in to add items.");
        showAuthPage();
        return;
    }
    const products = getLocalFallbackProducts();
    const item = products.find(p => p.id === productId);
    if (!item) return;
    const storage = selectedStorageMap[productId] || "256GB";
    const price = calcPrice(item.basePrice, storage);
    const existing = currentActiveCart.find(i => i.id === productId && i.storage === storage);
    if (existing) existing.qty++;
    else currentActiveCart.push({ id: productId, baseName: item.baseName, storage, price, qty: 1 });
    localStorage.setItem('lillex_active_cart', JSON.stringify(currentActiveCart));
    updateCartIconBadge();
    toast(`${item.baseName} (${storage}) added!`);
}

function updateCartIconBadge() {
    const count = currentActiveCart.reduce((s, i) => s + i.qty, 0);
    const badge = document.getElementById('cartCount');
    badge.textContent = count;
    count > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden');
    const hc = document.getElementById('cartHeaderCount');
    if (hc) hc.textContent = count > 0 ? count : '';
}

function renderCartList() {
    const list = document.getElementById('cartItemsList');
    if (!list) return;
    list.innerHTML = "";
    if (currentActiveCart.length === 0) {
        list.innerHTML = `<div class="cart-empty"><i class="fa-solid fa-bag-shopping"></i><p>Your cart is empty.</p></div>`;
        document.getElementById('cartTotalDisplay').textContent = "₦0";
        return;
    }
    let total = 0;
    currentActiveCart.forEach((item, idx) => {
        total += item.price * item.qty;
        list.insertAdjacentHTML('beforeend', `
            <div class="cart-item">
                <div class="cart-item-info">
                    <div class="cart-item-name">${item.baseName}</div>
                    <div class="cart-item-storage">${item.storage}</div>
                    <div class="cart-item-price">₦${item.price.toLocaleString()} each</div>
                </div>
                <div class="cart-item-controls">
                    <button class="qty-btn qty-reduce" data-idx="${idx}">−</button>
                    <span class="qty-num">${item.qty}</span>
                    <button class="qty-btn qty-increase" data-idx="${idx}">+</button>
                </div>
            </div>
        `);
    });
    document.getElementById('cartTotalDisplay').textContent = `₦${total.toLocaleString()}`;
    list.querySelectorAll('.qty-reduce').forEach(b => b.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        if (currentActiveCart[idx].qty > 1) currentActiveCart[idx].qty--;
        else currentActiveCart.splice(idx, 1);
        localStorage.setItem('lillex_active_cart', JSON.stringify(currentActiveCart));
        updateCartIconBadge(); renderCartList();
    }));
    list.querySelectorAll('.qty-increase').forEach(b => b.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        currentActiveCart[idx].qty++;
        localStorage.setItem('lillex_active_cart', JSON.stringify(currentActiveCart));
        updateCartIconBadge(); renderCartList();
    }));
}

// ==========================================
// CHECKOUT
// ==========================================
function launchCheckout() {
    if (currentActiveCart.length === 0) { toast("Your cart is empty."); return; }
    if (!currentUserProfile?.address || !currentUserProfile?.phone) {
        closeCart();
        showCompleteProfileModal();
        toast("Please complete your delivery details first.");
        return;
    }
    closeCart();
    transientProofOfPaymentBase64 = "";
    document.getElementById('storeSection').classList.add('hidden');
    document.getElementById('trustBanner').classList.add('hidden');
    document.getElementById('checkoutEmail').value = currentUser.email;
    document.getElementById('checkoutAddress').value = currentUserProfile.address;

    const summaryEl = document.getElementById('checkoutSummaryItems');
    let total = 0;
    summaryEl.innerHTML = "";
    currentActiveCart.forEach(item => {
        const sub = item.price * item.qty;
        total += sub;
        summaryEl.insertAdjacentHTML('beforeend', `
            <div class="checkout-summary-item">
                <span class="item-label">${item.baseName} (${item.storage}) ×${item.qty}</span>
                <span class="item-price">₦${sub.toLocaleString()}</span>
            </div>
        `);
    });
    document.getElementById('checkoutTotalDisplay').textContent = `₦${total.toLocaleString()}`;
    document.getElementById('checkoutFormSection').classList.remove('hidden');
    handlePaymentMethodContextChange();
}

function setupPaymentMethodToggle() {
    document.getElementById('paymentMethodGrid').addEventListener('click', (e) => {
        const opt = e.target.closest('.payment-option');
        if (!opt) return;
        document.querySelectorAll('.payment-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        opt.querySelector('input[type="radio"]').checked = true;
        handlePaymentMethodContextChange();
    });
}

function handlePaymentMethodContextChange() {
    const method = document.querySelector('input[name="payMethod"]:checked')?.value;
    const area = document.getElementById('bankDetailsArea');
    if (method === "Direct Naira Bank Transfer") {
        area.classList.remove('hidden');
        document.getElementById('checkoutProofFile').required = true;
    } else {
        area.classList.add('hidden');
        document.getElementById('checkoutProofFile').required = false;
    }
}

async function submitOrder(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.textContent = 'Placing order...';
    btn.disabled = true;

    const payMethod = document.querySelector('input[name="payMethod"]:checked')?.value || "Direct Naira Bank Transfer";
    const notes = document.getElementById('checkoutInstructions').value.trim();

    const orderObj = {
        orderId: "LILLEX-" + Math.floor(100000 + Math.random() * 900000),
        timestamp: new Date().toLocaleString(),
        customerEmail: currentUser.email,
        customerName: currentUserProfile.name,
        customerPhone: currentUserProfile.phone,
        deliveryAddress: currentUserProfile.address,
        paymentStrategy: payMethod,
        instructions: notes || "None.",
        purchasedItems: [...currentActiveCart],
        grandTotalCost: currentActiveCart.reduce((s, i) => s + i.price * i.qty, 0),
        isApproved: false,
        proofImage: payMethod === "Direct Naira Bank Transfer" ? transientProofOfPaymentBase64 : "",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await db.collection('orders').add(orderObj);
        currentActiveCart = [];
        localStorage.removeItem('lillex_active_cart');
        updateCartIconBadge();
        document.getElementById('orderCheckoutFinalForm').reset();
        document.getElementById('checkoutFormSection').classList.add('hidden');
        document.getElementById('successSplashModal').classList.remove('hidden');
        resetFileUpload('checkoutProofFile', 'filePreviewArea', 'fileUploadZone');
    } catch (err) {
        toast("Order failed. Please try again.");
    }
    btn.innerHTML = '<i class="fa-solid fa-shield-halved"></i> Place Order Securely';
    btn.disabled = false;
}

// ==========================================
// FILE UPLOADS
// ==========================================
function setupFileUploadZones() {
    // Checkout proof
    document.getElementById('checkoutProofFile').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            transientProofOfPaymentBase64 = ev.target.result;
            document.getElementById('filePreviewImg').src = ev.target.result;
            document.getElementById('filePreviewArea').classList.remove('hidden');
            document.getElementById('fileUploadZone').querySelector('.file-upload-inner').classList.add('hidden');
        };
        reader.readAsDataURL(file);
    });
    document.getElementById('removeFileBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        resetFileUpload('checkoutProofFile', 'filePreviewArea', 'fileUploadZone');
        transientProofOfPaymentBase64 = "";
    });

    // Admin product image
    document.getElementById('pAssetImageFile').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            document.getElementById('adminFilePreviewImg').src = ev.target.result;
            document.getElementById('adminFilePreviewArea').classList.remove('hidden');
            document.getElementById('adminFileUploadZone').querySelector('.file-upload-inner').classList.add('hidden');
        };
        reader.readAsDataURL(file);
    });
    document.getElementById('adminRemoveFileBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        resetFileUpload('pAssetImageFile', 'adminFilePreviewArea', 'adminFileUploadZone');
    });
}

function resetFileUpload(inputId, previewAreaId, zoneId) {
    document.getElementById(inputId).value = "";
    document.getElementById(previewAreaId).classList.add('hidden');
    document.getElementById(zoneId).querySelector('.file-upload-inner').classList.remove('hidden');
}

// ==========================================
// CUSTOMER DASHBOARD
// ==========================================
async function renderCustomerDashboard() {
    document.getElementById('profName').textContent = currentUserProfile.name || '-';
    document.getElementById('profEmail').textContent = currentUser.email || '-';
    document.getElementById('profPhone').textContent = currentUserProfile.phone || 'Not set';
    document.getElementById('profAddress').textContent = currentUserProfile.address || 'Not set';

    const container = document.getElementById('customerOrdersHistoryQueue');
    container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading orders...</p></div>`;

    try {
        const snap = await db.collection('orders')
            .where('customerEmail', '==', currentUser.email)
            .get();

        container.innerHTML = "";
        if (snap.empty) {
            container.innerHTML = `<p style="color:var(--muted);text-align:center;padding:2rem;">No orders yet.</p>`;
            return;
        }
        snap.forEach(doc => {
            const o = doc.data();
            const items = o.purchasedItems.map(i => `${i.baseName} (${i.storage}) ×${i.qty}`).join(", ");
            const statusClass = o.isApproved ? 'approved' : 'pending';
            const statusText = o.isApproved
                ? '<i class="fa-solid fa-circle-check"></i> Approved & Dispatched'
                : '<i class="fa-solid fa-hourglass-half"></i> Pending Approval';
            container.insertAdjacentHTML('beforeend', `
                <div class="order-card">
                    <div class="order-card-head">
                        <span class="order-id">${o.orderId}</span>
                        <span class="order-date">${o.timestamp}</span>
                    </div>
                    <div class="order-items">${items}</div>
                    <div style="font-size:0.78rem;color:var(--muted);margin-bottom:0.25rem;">${o.paymentStrategy}</div>
                    <div style="font-weight:700;font-size:0.9rem;">₦${o.grandTotalCost.toLocaleString()}</div>
                    <div class="order-status ${statusClass}">${statusText}</div>
                </div>
            `);
        });
    } catch (err) {
        container.innerHTML = `<p style="color:var(--muted);text-align:center;padding:2rem;">Could not load orders.</p>`;
    }
}

// ==========================================
// ADMIN — INVENTORY
// ==========================================
async function adminLoadInventory() {
    const stream = document.getElementById('adminInventoryList');
    stream.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading...</p></div>`;
    try {
        const snap = await db.collection('products').get();
        stream.innerHTML = "";
        snap.forEach(doc => {
            const p = { id: doc.id, ...doc.data() };
            const imgEl = p.imageAsset ? `<img src="${p.imageAsset}" alt="${p.baseName}">` : `<i class="fa-solid fa-image"></i>`;
            stream.insertAdjacentHTML('beforeend', `
                <div class="admin-inventory-item">
                    <div class="admin-prod-img-mini">${imgEl}</div>
                    <div class="admin-prod-info">
                        <div class="admin-prod-name">${p.baseName}</div>
                        <div class="admin-prod-series">${p.series}</div>
                        <div class="admin-prod-price">₦${p.basePrice.toLocaleString()}</div>
                        <div class="admin-prod-stock ${p.inStock ? 'in' : 'out'}">● ${p.inStock ? 'In Stock' : 'Out of Stock'}</div>
                    </div>
                    <div class="admin-prod-actions">
                        <button class="admin-action-btn img" data-id="${p.id}">Image</button>
                        <button class="admin-action-btn price" data-id="${p.id}" data-name="${p.baseName}" data-price="${p.basePrice}">Price</button>
                        <button class="admin-action-btn stock" data-id="${p.id}" data-stock="${p.inStock}">Stock</button>
                        <button class="admin-action-btn del" data-id="${p.id}" data-name="${p.baseName}">Delete</button>
                    </div>
                </div>
            `);
        });

        stream.querySelectorAll('.admin-action-btn.img').forEach(b => b.addEventListener('click', () => {
            activeProductImageRowTargetId = b.dataset.id;
            document.getElementById('inventoryRowImageFileTrigger').click();
        }));
        stream.querySelectorAll('.admin-action-btn.price').forEach(b => b.addEventListener('click', () => {
            activePriceEditId = b.dataset.id;
            document.getElementById('priceEditTargetName').textContent = b.dataset.name;
            document.getElementById('customNewPriceInput').value = b.dataset.price;
            document.getElementById('priceEditModal').classList.remove('hidden');
        }));
        stream.querySelectorAll('.admin-action-btn.stock').forEach(b => b.addEventListener('click', async () => {
            const newStock = b.dataset.stock === 'true' ? false : true;
            await db.collection('products').doc(b.dataset.id).update({ inStock: newStock });
            toast("Stock status updated.");
            adminLoadInventory();
        }));
        stream.querySelectorAll('.admin-action-btn.del').forEach(b => b.addEventListener('click', () => {
            activeDeleteTargetId = b.dataset.id;
            document.getElementById('deleteModalMessage').textContent = `Delete "${b.dataset.name}" permanently?`;
            document.getElementById('deleteConfirmModal').classList.remove('hidden');
        }));
    } catch (err) {
        stream.innerHTML = `<p style="color:var(--muted);padding:1rem;">Failed to load inventory.</p>`;
    }
}

async function adminUpdateRowImage(e) {
    const file = e.target.files[0];
    if (!file || !activeProductImageRowTargetId) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
        await db.collection('products').doc(activeProductImageRowTargetId).update({ imageAsset: ev.target.result });
        toast("Image updated!");
        adminLoadInventory();
        loadProductsFromFirestore();
    };
    reader.readAsDataURL(file);
    e.target.value = "";
}

async function adminSavePrice() {
    const val = parseInt(document.getElementById('customNewPriceInput').value);
    if (!isNaN(val) && val > 0 && activePriceEditId) {
        await db.collection('products').doc(activePriceEditId).update({ basePrice: val });
        document.getElementById('priceEditModal').classList.add('hidden');
        toast("Price updated.");
        adminLoadInventory();
        loadProductsFromFirestore();
    }
}

async function adminDeleteProduct() {
    if (activeDeleteTargetId) {
        await db.collection('products').doc(activeDeleteTargetId).delete();
        document.getElementById('deleteConfirmModal').classList.add('hidden');
        toast("Product deleted.");
        adminLoadInventory();
        loadProductsFromFirestore();
    }
}

async function adminAddProduct(e) {
    e.preventDefault();
    const baseName = document.getElementById('pName').value.trim();
    const series = document.getElementById('pCategorySelect').value;
    const basePrice = parseInt(document.getElementById('pPrice').value);
    const desc = document.getElementById('pDesc').value.trim();
    const fileInput = document.getElementById('pAssetImageFile');
    const btn = e.target.querySelector('button[type="submit"]');
    btn.textContent = 'Saving...'; btn.disabled = true;

    const save = async (img) => {
        await db.collection('products').add({
            baseName, series, basePrice, desc, inStock: true, imageAsset: img,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        document.getElementById('productManageForm').reset();
        resetFileUpload('pAssetImageFile', 'adminFilePreviewArea', 'adminFileUploadZone');
        adminLoadInventory();
        loadProductsFromFirestore();
        toast("Product added!");
        btn.textContent = 'Add Product'; btn.disabled = false;
    };

    if (fileInput.files && fileInput.files[0]) {
        const reader = new FileReader();
        reader.onload = (ev) => save(ev.target.result);
        reader.readAsDataURL(fileInput.files[0]);
    } else {
        await save("");
        btn.textContent = 'Add Product'; btn.disabled = false;
    }
}

// ==========================================
// ADMIN — ORDERS
// ==========================================
async function adminLoadOrders() {
    const activeEl = document.getElementById('adminOrdersQueue');
    const archiveEl = document.getElementById('adminOrdersArchivedHistory');
    activeEl.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading...</p></div>`;
    archiveEl.innerHTML = "";

    try {
        const snap = await db.collection('orders').get();
        activeEl.innerHTML = "";
        let hasPending = false, hasApproved = false;

        snap.forEach(doc => {
            const o = { firestoreId: doc.id, ...doc.data() };
            if (!o.isApproved) {
                hasPending = true;
                const contents = o.purchasedItems.map(i => `${i.baseName} (${i.storage}) ×${i.qty}`).join("<br>");
                const proofHTML = o.proofImage
                    ? `<img src="${o.proofImage}" class="proof-img-preview-mini" alt="Receipt">`
                    : `<span style="color:var(--muted);font-size:0.75rem;font-style:italic;">Cash on Delivery</span>`;
                activeEl.insertAdjacentHTML('beforeend', `
                    <div class="admin-order-card">
                        <div class="admin-order-id">${o.orderId} · ${o.timestamp}</div>
                        <div style="margin:0.3rem 0;"><strong>${o.customerName}</strong> · ${o.customerPhone}</div>
                        <div style="color:var(--muted);font-size:0.78rem;margin-bottom:0.4rem;">${o.deliveryAddress}</div>
                        <div style="background:#0d0d0d;border-left:2px solid var(--neon);padding:0.5rem 0.75rem;border-radius:4px;margin-bottom:0.5rem;font-size:0.78rem;">${contents}</div>
                        <div style="font-size:0.75rem;color:var(--muted);margin-bottom:0.4rem;">${o.paymentStrategy} · ${o.instructions}</div>
                        ${proofHTML}
                        <div style="font-weight:700;color:var(--neon);margin:0.6rem 0;">₦${o.grandTotalCost.toLocaleString()}</div>
                        <button class="solid-btn approve-btn" data-fid="${o.firestoreId}" data-oid="${o.orderId}" style="width:100%;">
                            <i class="fa-solid fa-circle-check"></i> Approve Order
                        </button>
                    </div>
                `);
            } else {
                hasApproved = true;
                archiveEl.insertAdjacentHTML('beforeend', `
                    <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px dashed var(--border);font-size:0.78rem;">
                        <div><strong style="color:var(--neon);">${o.orderId}</strong> · ${o.customerEmail}</div>
                        <div style="color:var(--muted);">₦${o.grandTotalCost.toLocaleString()}</div>
                    </div>
                `);
            }
        });

        if (!hasPending) activeEl.innerHTML = `<p style="color:var(--muted);text-align:center;padding:1.5rem;font-size:0.85rem;">No pending orders.</p>`;
        if (!hasApproved) archiveEl.innerHTML = `<p style="color:var(--muted);font-size:0.8rem;padding:1rem;text-align:center;">No dispatched orders yet.</p>`;

        activeEl.querySelectorAll('.approve-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                await db.collection('orders').doc(btn.dataset.fid).update({ isApproved: true });
                toast(`Order ${btn.dataset.oid} approved!`);
                adminLoadOrders();
            });
        });
    } catch (err) {
        activeEl.innerHTML = `<p style="color:var(--muted);padding:1rem;">Failed to load orders.</p>`;
    }
}

// ==========================================
// DASHBOARD TABS
// ==========================================
function setupDashboardTabs(sectionSelector) {
    const section = document.querySelector(sectionSelector);
    if (!section) return;
    section.querySelectorAll('.dash-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            section.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
            section.querySelectorAll('.dash-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const panel = document.getElementById(tab.dataset.panel);
            if (panel) panel.classList.add('active');
        });
    });
}

// ==========================================
// TOAST
// ==========================================
function toast(message) {
    const el = document.getElementById('toastNotification');
    el.innerHTML = `<i class="fa-solid fa-bolt neon-text"></i> ${message}`;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 2800);
}

function showAuthError(msg) {
    const el = document.getElementById('authErrorMsg');
    el.textContent = msg;
    el.classList.remove('hidden');
}
