// Safe storage wrappers: detect if localStorage is available, otherwise fallback to in-memory object
function storageAvailable(type = 'localStorage') {
    try {
        var storage = window[type];
        var x = '__storage_test__';
        storage.setItem(x, x);
        storage.removeItem(x);
        return true;
    }
    catch (e) {
        return false;
    }
}

const _storageFallback = {};
function safeGetItem(key) {
    if (storageAvailable('localStorage')) {
        try { return localStorage.getItem(key); } catch(e){ return _storageFallback[key] || null; }
    }
    return _storageFallback.hasOwnProperty(key) ? _storageFallback[key] : null;
}
function safeSetItem(key, value) {
    if (storageAvailable('localStorage')) {
        try { localStorage.setItem(key, value); return; } catch(e) { _storageFallback[key] = value; return; }
    }
    _storageFallback[key] = value;
}

class PaymentManager {
    constructor() {
     this.db = firebase.database();
     const user = window.currentUser || firebase.auth().currentUser;
     if (!user) {
        console.error('Utilisateur non connecté!');
        window.location.href = 'login.html';
        return;
     }
     this.userId = user.uid;
     console.log('PaymentManager initialisé pour utilisateur:', this.userId);
this.members = [];
this.payments = [];
this.lots = [];
    const storedSelected = safeGetItem('selectedMembers');
    this.selectedMembers = storedSelected ? new Set(JSON.parse(storedSelected).map(String)) : new Set();
    this._selectionDelegated = false;
    this.config = {};
        this.currentTab = 'dashboard';
        this.currentMonth = new Date().getMonth();
        this.currentYear = new Date().getFullYear();
        this.init();
    }
    loadFromFirebase() {
    // Charger membres en temps réel
    this.db.ref(`users/${this.userId}/appData/members`).on('value', (snapshot) => {
        this.members = snapshot.val() || [];
        this.renderMembers();
        this.updateDashboard();
        this.maybeMigrateUnitPrice();
    });

    // Charger paiements en temps réel
    this.db.ref(`users/${this.userId}/appData/payments`).on('value', (snapshot) => {
        this.payments = snapshot.val() || [];
        this.renderPayments();
        this.updateDashboard();
    });

    // Charger lots en temps réel
    this.db.ref(`users/${this.userId}/appData/lots`).on('value', (snapshot) => {
        this.lots = snapshot.val() || [];
        this.renderLots();
        this.updateDashboard();
        this.maybeMigrateUnitPrice();
    });

    // Charger config en temps réel (inclut unitPrice)
    this.db.ref(`users/${this.userId}/appData/config`).on('value', (snapshot) => {
        this.config = snapshot.val() || {};
        const unitEl = document.getElementById('currentUnitPrice');
        if (unitEl) unitEl.textContent = this.formatCurrency(this.getUnitPrice());
        this.renderLots();
        this.renderMembers();
        this.updateDashboard();
        this.maybeMigrateUnitPrice();
    });
}

saveMembers() {
    this.db.ref(`users/${this.userId}/appData/members`).set(this.members);
}

savePayments() {
    this.db.ref(`users/${this.userId}/appData/payments`).set(this.payments);
}

saveLots() {
    this.db.ref(`users/${this.userId}/appData/lots`).set(this.lots);
}

saveConfig() {
    this.db.ref(`users/${this.userId}/appData/config`).set(this.config || {});
}

getUnitPrice() {
    if (this.config && this.config.unitPrice != null) {
        return Number(this.config.unitPrice) || 0;
    }
    return this.lots && this.lots.length > 0 ? Number(this.lots[0].price) || 0 : 0;
}

getSvgIcon(name, size = 20) {
    const s = Number(size);
    const common = `width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"`;
    switch (name) {
        case 'building':
            return `<svg ${common}><rect x="3" y="4" width="18" height="16" rx="2" stroke="#2C3E50" stroke-width="1.2" fill="#F8F9FA"/><rect x="7" y="8" width="2" height="2" fill="#2C3E50"/><rect x="11" y="8" width="2" height="2" fill="#2C3E50"/><rect x="15" y="8" width="2" height="2" fill="#2C3E50"/></svg>`;
        case 'wallet':
            return `<svg ${common}><rect x="2" y="6" width="20" height="12" rx="2" stroke="#27AE60" stroke-width="1.2" fill="#fff"/><circle cx="18" cy="12" r="1.6" fill="#27AE60"/></svg>`;
        case 'bullseye':
            return `<svg ${common}><circle cx="12" cy="12" r="9" stroke="#181818" stroke-width="1.2" fill="none"/><circle cx="12" cy="12" r="5" stroke="#181818" stroke-width="1.2" fill="none"/></svg>`;
        case 'percentage':
            return `<svg ${common}><path d="M4 4L20 20" stroke="#F39C12" stroke-width="1.6"/><circle cx="7.5" cy="7.5" r="1.8" fill="#F39C12"/><circle cx="16.5" cy="16.5" r="1.8" fill="#F39C12"/></svg>`;
        case 'home':
            return `<svg ${common}><path d="M3 11L12 4L21 11" stroke="#181818" stroke-width="1.2" fill="none"/><rect x="6" y="11" width="12" height="8" rx="1" stroke="#181818" stroke-width="1.2" fill="#fff"/></svg>`;
        case 'table':
            return `<svg ${common}><rect x="3" y="4" width="18" height="16" rx="1" stroke="#2C3E50" stroke-width="1.2" fill="#fff"/><path d="M3 10h18M10 4v16" stroke="#2C3E50" stroke-width="1"/></svg>`;
        case 'chart-bar':
            return `<svg ${common}><rect x="4" y="10" width="3" height="10" rx="0.5" fill="#27AE60"/><rect x="10.5" y="6" width="3" height="14" rx="0.5" fill="#181818"/><rect x="17" y="3" width="3" height="17" rx="0.5" fill="#F39C12"/></svg>`;
        case 'users':
            return `<svg ${common}><circle cx="9" cy="8" r="2.2" fill="#2C3E50"/><path d="M4 18c1.5-4 7-4 8 0" stroke="#2C3E50" stroke-width="1.2" fill="none"/><circle cx="17" cy="8" r="1.8" fill="#5D6D7E"/></svg>`;
        default:
            return `<svg ${common}><circle cx="12" cy="12" r="10" stroke="#2C3E50" stroke-width="1.2" fill="#fff"/></svg>`;
    }
}

    /* Selection helpers: unified API to manage member selection and UI updates */
    selectMember(id) {
        if (!id) return;
        id = String(id);
        this.selectedMembers.add(id);
        safeSetItem('selectedMembers', JSON.stringify(Array.from(this.selectedMembers)));
        this.updateSelectionUI();
    }

    deselectMember(id) {
        if (!id) return;
        id = String(id);
        this.selectedMembers.delete(id);
        safeSetItem('selectedMembers', JSON.stringify(Array.from(this.selectedMembers)));
        this.updateSelectionUI();
    }

    toggleMemberSelection(id) {
        if (!id) return;
        id = String(id);
        if (this.selectedMembers.has(id)) this.deselectMember(id); else this.selectMember(id);
    }

    updateSelectionUI() {
        const membersGrid = document.getElementById('membersGrid');
        if (!membersGrid) return;
        // sync checkboxes
        membersGrid.querySelectorAll('.member-select, .member-select-checkbox').forEach(cb => {
            const id = cb.dataset.memberId;
            if (!id) return;
            cb.checked = this.selectedMembers.has(String(id));
        });
        // highlight rows/cards
        membersGrid.querySelectorAll('.member-row, .member-card').forEach(el => {
            const id = el.dataset.memberId;
            if (!id) return;
            el.classList.toggle('selected', this.selectedMembers.has(String(id)));
        });
        const bulkActions = document.getElementById('membersBulkActions');
        if (bulkActions) bulkActions.style.display = this.selectedMembers.size > 0 ? 'flex' : 'none';

        const selectAllGlobal = document.getElementById('selectAllMembersGlobal');
        if (selectAllGlobal) {
            const visible = membersGrid.querySelectorAll('.member-select, .member-select-checkbox');
            selectAllGlobal.checked = visible.length > 0 && Array.from(visible).every(cb => cb.checked);
        }

        const selectAll = membersGrid.querySelector('#selectAllMembers');
        if (selectAll) {
            const tableCbs = membersGrid.querySelectorAll('.member-select');
            selectAll.checked = tableCbs.length > 0 && Array.from(tableCbs).every(cb => cb.checked);
        }

        const bulkInfo = document.querySelector('.bulk-info');
        if (bulkInfo) bulkInfo.textContent = `${this.selectedMembers.size} sélectionné(s)`;
    }

    attachSelectionDelegation() {
        if (this._selectionDelegated) return;
        const membersGrid = document.getElementById('membersGrid');
        if (!membersGrid) return;

        membersGrid.addEventListener('change', (e) => {
            const target = e.target;
            if (target && (target.matches('.member-select') || target.matches('.member-select-checkbox'))) {
                const id = target.dataset.memberId;
                if (target.checked) this.selectMember(id); else this.deselectMember(id);
            }
        });

        // Global header select-all (toolbar) - keep in delegated setup to avoid duplicate listeners
        const selectAllGlobal = document.getElementById('selectAllMembersGlobal');
        if (selectAllGlobal) {
            selectAllGlobal.addEventListener('change', () => {
                const checkboxes = membersGrid.querySelectorAll('.member-select, .member-select-checkbox');
                if (selectAllGlobal.checked) {
                    checkboxes.forEach(cb => { if (cb.dataset.memberId) this.selectMember(cb.dataset.memberId); });
                } else {
                    checkboxes.forEach(cb => { if (cb.dataset.memberId) this.deselectMember(cb.dataset.memberId); });
                }
            });
        }

        this._selectionDelegated = true;
    }

    attachGlobalAscendingSortHandlers() {
        // Attache un handler simple sur tous les <table> pour tri ascendant (toujours du plus petit au plus grand)
        document.querySelectorAll('table').forEach(table => {
            if (table.dataset.ascSortAttached === '1') return;
            const thead = table.querySelector('thead');
            if (!thead) return;
            const ths = Array.from(thead.querySelectorAll('th'));
            ths.forEach((th, colIndex) => {
                th.style.cursor = 'pointer';
                th.addEventListener('click', (e) => {
                    e.preventDefault();
                    const tbody = table.tBodies[0] || table.querySelector('tbody');
                    if (!tbody) return;
                    const rows = Array.from(tbody.querySelectorAll('tr'));
                    rows.sort((ra, rb) => {
                        const a = (ra.children[colIndex] && ra.children[colIndex].textContent || '').trim();
                        const b = (rb.children[colIndex] && rb.children[colIndex].textContent || '').trim();
                        const an = parseFloat(a.replace(/[^0-9.,-]/g, '').replace(/,/g, '.'));
                        const bn = parseFloat(b.replace(/[^0-9.,-]/g, '').replace(/,/g, '.'));
                        if (!isNaN(an) && !isNaN(bn)) return an - bn;
                        const ad = Date.parse(a);
                        const bd = Date.parse(b);
                        if (!isNaN(ad) && !isNaN(bd)) return ad - bd;
                        return a.localeCompare(b, 'fr', {numeric: true});
                    });
                    rows.forEach(r => tbody.appendChild(r));
                });
            });
            table.dataset.ascSortAttached = '1';
        });
    }

    async exportStatistics() {
    try {
        const selectedYear = document.getElementById('statsYearFilter').value || new Date().getFullYear();
        const year = parseInt(selectedYear);

        this.showNotification('Génération du rapport annuel PDF en cours...', 'info');

        // Filtrer les paiements de l'année sélectionnée
        const paymentsYear = this.payments.filter(p => new Date(p.date).getFullYear() === year);
        const filteredMembers = this.members.filter(m => 
            this.payments.some(p => new Date(p.date).getFullYear() === year && p.memberId === m.id)
        );

        const totalCollected = paymentsYear.reduce((sum, p) => sum + (p.amount || 0), 0);
        const totalMembers = this.members.length;
        const averagePerMember = totalMembers > 0 ? totalCollected / totalMembers : 0;
        const totalLotsPrice = this.lots.reduce((sum, lot) => sum + (lot.price || 0), 0);
        const averageProgress = totalLotsPrice > 0 ? (totalCollected / totalLotsPrice) * 100 : 0;

        const reportContainer = document.createElement('div');
        reportContainer.className = 'pdf-report-container';
        reportContainer.id = 'pdf-report-annual';
        const currentDate = new Date();

        reportContainer.innerHTML = `
            <div class="pdf-header">
                <div class="pdf-logo-section">
                    <div class="pdf-logo-icon">
                        <img src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QCMRXhpZgAATU0AKgAAAAgABQESAAMAAAABAAEAAAEaAAUAAAABAAAASgEbAAUAAAABAAAAUgEoAAMAAAABAAIAAIdpAAQAAAABAAAAWgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAA8CgAwAEAAAAAQAAA8AAAAAA/8AAEQgDwAPAAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAwMDAwMDBAMDBAYEBAQGCAYGBgYICggICAgICg0KCgoKCgoNDQ0NDQ0NDQ8PDw8PDxISEhISFBQUFBQUFBQUFP/bAEMBAwMDBQUFCQUFCRUODA4VFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFf/dAAQAPP/aAAwDAQACEQMRAD8A/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/0P1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//R/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/0v1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9P9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//1P1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9X9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/W/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9f9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/Q/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/0f1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//S/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/0/1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9T9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//1f1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9b9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/X/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9D9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/R/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADK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AoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9H9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/S/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9P9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/U/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/1f1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//W/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/1/1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9D9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//0f1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9L9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/T/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9T9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/V/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/1v1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//X/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/0P1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9H9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//0v1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9k=" style="height:40px;width:40px;border-radius:50%;" />
                    </div>
                    <div class="pdf-company-info">
                        <h1>TONTINE IMMOBILIER</h1>
                        <p>Gestionnaire de Tontines • Côte d'Ivoire</p>
                    </div>
                </div>
                <div class="pdf-report-meta">
                    <h2>Rapport Annuel</h2>
                    <p><strong>Année ${year}</strong></p>
                    <p>Généré le ${currentDate.toLocaleDateString('fr-FR')} à ${currentDate.toLocaleTimeString('fr-FR')}</p>
                </div>
            </div>

            <div class="pdf-metrics-grid">
                <div class="pdf-metric-card metric-collected">
                    <div class="pdf-metric-icon"></div>
                    <div class="pdf-metric-value">${this.formatCurrency(totalCollected)}</div>
                    <div class="pdf-metric-label">Total Collecté</div>
                </div>
                <div class="pdf-metric-card metric-expected">
                    <div class="pdf-metric-icon"></div>
                    <div class="pdf-metric-value">${this.formatCurrency(averagePerMember)}</div>
                    <div class="pdf-metric-label">Moyenne par membre</div>
                </div>
                <div class="pdf-metric-card metric-progress">
                    <div class="pdf-metric-icon"></div>
                    <div class="pdf-metric-value">${Math.round(averageProgress)}%</div>
                    <div class="pdf-metric-label">Progression Moyenne</div>
                </div>
                <div class="pdf-metric-card metric-lots">
                    <div class="pdf-metric-icon"></div>
                    <div class="pdf-metric-value">${this.lots.length}</div>
                    <div class="pdf-metric-label">Lots Disponibles</div>
                </div>
            </div>

            <div class="pdf-section">
                <h3 class="pdf-section-title">Performance par Lot</h3>
                <table class="pdf-table">
                    <thead>
                        <tr>
                            <th>Lot</th>
                            <th>Prix</th>
                            <th>Membres</th>
                            <th>Collecté</th>
                            <th>Progression</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.lots.map(lot => {
                            const lotMembers = this.members.filter(m => (m.numberOfLots || 0) > 0);
                            const lotPayments = this.payments.filter(p => {
                                const paymentYear = new Date(p.date).getFullYear();
                                return paymentYear == year && lotMembers.some(m => m.id === p.memberId);
                            });
                            const collected = lotPayments.reduce((sum, p) => sum + p.amount, 0);
                            const progress = lot.price > 0 ? (collected / lot.price) * 100 : 0;
                            return `
                                <tr>
                                    <td style="font-weight:500;">${lot.name}</td>
                                    <td>${this.formatCurrency(lot.price)}</td>
                                    <td>${lotMembers.length}</td>
                                    <td style="color:#27AE60;font-weight:600;">${this.formatCurrency(collected)}</td>
                                    <td>
                                        <div style="display:flex;align-items:center;gap:8px;">
                                            <div style="width:60px;height:6px;background:#E8EAED;border-radius:3px;overflow:hidden;">
                                                <div style="height:100%;background:linear-gradient(90deg,#27AE60,#2ECC71);width:${Math.min(progress,100)}%;"></div>
                                            </div>
                                            <span style="font-size:12px;font-weight:600;">${Math.round(progress)}%</span>
                                        </div>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>

            <div class="pdf-section">
                <h3 class="pdf-section-title">Détail des Paiements - Année ${year}</h3>
                <table class="pdf-table">
                    <thead>
                        <tr>
                            <th>Membre</th>
                            <th>Lot</th>
                            <th>Montant Annuel</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.members.map(member => {
                            const memberPayments = this.payments.filter(p => new Date(p.date).getFullYear() == year && p.memberId === member.id);
                            const totalPaid = memberPayments.reduce((sum, p) => sum + p.amount, 0);
                            return totalPaid > 0 && (member.numberOfLots || 0) > 0 ? `
                                <tr>
                                    <td>${member.name}</td>
                                    <td>${member.numberOfLots} lot(s)</td>
                                    <td style="color:#27AE60;font-weight:600;">${this.formatCurrency(totalPaid)}</td>
                                </tr>
                            ` : '';
                        }).join('')}
                    </tbody>
                </table>
            </div>

                 <!-- Pied de page -->
                <div class="pdf-footer">
                    <p><strong>CI Habitat</strong> - L'immobilier Autrement</p>
                    <p>Rapport généré  le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}</p>
                    <p>Pour plus d'informations, contactez le ☎️ 01 618 837 90.</p>
                </div>
        `;

        document.body.appendChild(reportContainer);
        await new Promise(resolve => setTimeout(resolve, 500));
        const canvas = await html2canvas(reportContainer, { 
            scale: 2, 
            useCORS: true, 
            backgroundColor: '#ffffff',
            ignoreElements: (element) => {
                return element.tagName === 'CANVAS' || element.classList.contains('chartjs-size-monitor');
            }
        });
        document.body.removeChild(reportContainer);

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgData = canvas.toDataURL('image/png');
        const imgWidth = 210;
        const pageHeight = 295;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        let heightLeft = imgHeight;
        let position = 0;

        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
        while (heightLeft >= 0) {
            position = heightLeft - imgHeight;
            pdf.addPage();
            pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;
        }

        const fileName = `Rapport_Annuel_${year}_${Date.now()}.pdf`;
        pdf.save(fileName);
        this.showNotification('Rapport annuel PDF généré avec succès !', 'success');

    } catch (error) {
        console.error('Erreur génération rapport annuel :', error);
        this.showNotification('Erreur lors de la génération du rapport annuel', 'error');
    }
}

    async generateStyledMonthlyReport() {
        try {

            this.showNotification('Génération du rapport PDF en cours...', 'info');

            const reportContainer = document.createElement('div');
            reportContainer.className = 'pdf-report-container';
            reportContainer.id = 'pdf-report-temp';

            const monthlyStats = this.getMonthlyStats();
            const monthNames = [
                'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
                'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
            ];

            const currentDate = new Date();
            const monthName = monthNames[this.currentMonth];
            const year = this.currentYear;

            reportContainer.innerHTML = `
                <!-- En-tête professionnel -->
                <div class="pdf-header">
                    <div class="pdf-logo-section">
                        <div class="pdf-logo-icon">
                        <img src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QCMRXhpZgAATU0AKgAAAAgABQESAAMAAAABAAEAAAEaAAUAAAABAAAASgEbAAUAAAABAAAAUgEoAAMAAAABAAIAAIdpAAQAAAABAAAAWgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAA8CgAwAEAAAAAQAAA8AAAAAA/8AAEQgDwAPAAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAwMDAwMDBAMDBAYEBAQGCAYGBgYICggICAgICg0KCgoKCgoNDQ0NDQ0NDQ8PDw8PDxISEhISFBQUFBQUFBQUFP/bAEMBAwMDBQUFCQUFCRUODA4VFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFf/dAAQAPP/aAAwDAQACEQMRAD8A/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/0P1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//R/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/0v1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9P9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//1P1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9X9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/W/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9f9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/Q/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/0f1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//S/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/0/1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9T9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//1f1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9b9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/X/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9D9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/R/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADK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AoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9H9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/S/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9P9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/U/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/1f1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//W/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/1/1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9D9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//0f1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9L9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/T/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9T9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/V/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/1v1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//X/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/0P1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9H9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//0v1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9k=" style="height:40px;width:40px;border-radius:50%;" />
                        </div>
                        <div class="pdf-company-info">
                            <h1>CI Habitat IMMOBILER</h1>

                            <p>L'immobilier Autrement • Côte d'Ivoire</p>
                        </div>
                    </div>
                    <div class="pdf-report-meta">
                        <h2>Rapport Mensuel</h2>
                        <p><strong>${monthName} ${year}</strong></p>
                        <p>Généré le ${currentDate.toLocaleDateString('fr-FR')}</p>
                    </div>
                </div>

                <!-- Métriques principales -->
                <div class="pdf-metrics-grid">
                    <div class="pdf-metric-card metric-collected">
                        <div class="pdf-metric-icon" style="background: #27AE60;">
                            <i class="fas fa-wallet"></i>
                        </div>
                        <div class="pdf-metric-value">${this.formatCurrency(monthlyStats.collected)}</div>
                        <div class="pdf-metric-label">Total Collecté</div>
                    </div>
                    <div class="pdf-metric-card metric-expected">
                        <div class="pdf-metric-icon" style="background: #2C3E50;">
                            <i class="fas fa-bullseye"></i>
                        </div>
                        <div class="pdf-metric-value">${this.formatCurrency(monthlyStats.expected)}</div>
                        <div class="pdf-metric-label">Objectif Mensuel</div>
                    </div>
                    <div class="pdf-metric-card metric-progress">
                        <div class="pdf-metric-icon" style="background: #E67E22;">
                            <i class="fas fa-percentage"></i>
                        </div>
                        <div class="pdf-metric-value">${Math.round(monthlyStats.progressRate)}%</div>
                        <div class="pdf-metric-label">Taux de Progression</div>
                    </div>
                    <div class="pdf-metric-card metric-lots">
                        <div class="pdf-metric-icon" style="background: #3498DB;">
                            <i class="fas fa-home"></i>
                        </div>
                        <div class="pdf-metric-value">${this.lots.length}</div>
                        <div class="pdf-metric-label">Lots Disponibles</div>
                    </div>
                </div>

                <!-- Progression mensuelle -->
                <div class="pdf-progress-container">
                    <div class="pdf-progress-header">
                        <h3 style="margin: 0; color: #2C3E50;">Progression du Mois</h3>
                        <span style="font-weight: 600; color: #27AE60;">${Math.round(monthlyStats.progressRate)}%</span>
                    </div>
                    <div class="pdf-progress-bar">
                        <div class="pdf-progress-fill" style="width: ${Math.min(monthlyStats.progressRate, 100)}%"></div>
                    </div>
                    <div class="pdf-summary-stats">
                        <div class="pdf-stat-item">
                            <div class="pdf-stat-value">${monthlyStats.paidMembers}</div>
                            <div class="pdf-stat-label">Membres ayant payé</div>
                        </div>
                        <div class="pdf-stat-item">
                            <div class="pdf-stat-value">${monthlyStats.totalMembers - monthlyStats.paidMembers}</div>
                            <div class="pdf-stat-label">En attente</div>
                        </div>
                        <div class="pdf-stat-item">
                            <div class="pdf-stat-value">${monthlyStats.totalMembers}</div>
                            <div class="pdf-stat-label">Total membres</div>
                        </div>
                    </div>
                </div>

                <!-- Tableau des paiements -->
                <div class="pdf-section">
                    <h3 class="pdf-section-title">
                        <i class="fas fa-table"></i>
                        Détail des Paiements - ${monthName} ${year}
                    </h3>
                    <table class="pdf-table">
                        <thead>
                            <tr>
                                <th>Membre</th>
                                <th>Lot</th>
                                <th>Montant</th>
                                <th>Date</th>
                                <th>Statut</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.getMonthlyPayments().map(payment => {
                                const member = this.members.find(m => m.id === payment.memberId);
                                let lotDescription = 'N/A';
                                if (member && (member.numberOfLots || 0) > 0) {
                                    lotDescription = `${member.numberOfLots} lot(s)`;
                                }
                                return `
                                    <tr>
                                        <td style="font-weight: 500;">${member ? member.name : 'N/A'}</td>
                                        <td>${lotDescription}</td>
                                        <td style="color: #27AE60; font-weight: 600;">${this.formatCurrency(payment.amount)}</td>
                                        <td>${new Date(payment.date).toLocaleDateString('fr-FR')}</td>
                                        <td><span style="background: #27AE60; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px;">Payé</span></td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>

                <!-- Statistiques par lot -->
                <div class="pdf-section">
                    <h3 class="pdf-section-title">
                        <i class="fas fa-chart-bar"></i>
                        Performance par Lot
                    </h3>
                    <table class="pdf-table">
                        <thead>
                            <tr>
                                <th>Lot</th>
                                <th>Prix</th>
                                <th>Membres</th>
                                <th>Collecté</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.lots.map(lot => {
                                const lotPrice = lot.price || 0;
                                const lotMembers = this.members.filter(m => (m.numberOfLots || 0) > 0);
                                const lotPayments = this.payments.filter(p => lotMembers.some(m => m.id === p.memberId));
                                const collected = lotPayments.reduce((sum, p) => sum + p.amount, 0);
                                const expected = lotMembers.reduce((sum, m) => sum + ((m.numberOfLots || 0) * lotPrice), 0);
                                const progress = expected > 0 ? (collected / expected) * 100 : 0;

                                return `
                                    <tr>
                                        <td style="font-weight: 500;">${lot.name}</td>
                                        <td>${this.formatCurrency(lot.price)}</td>
                                        <td>${lotMembers.length}</td>
                                        <td style="color: #27AE60; font-weight: 600;">${this.formatCurrency(collected)}</td>

                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>

                <!-- Pied de page -->
                <div class="pdf-footer">
                    <p><strong>CI Habitat</strong> - L'immobilier Autrement</p>
                    <p>Rapport généré  le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}</p>
                    <p>Pour plus d'informations, contactez le ☎️ 01 618 837 90.</p>
                </div>
            `;

            document.body.appendChild(reportContainer);

            await new Promise(resolve => setTimeout(resolve, 500));

            const canvas = await html2canvas(reportContainer, {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff',
                letterRendering: true,
                logging: false,
                width: reportContainer.scrollWidth,
                height: reportContainer.scrollHeight
            });

            document.body.removeChild(reportContainer);

            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');

            const imgData = canvas.toDataURL('image/png');
            const imgWidth = 210;
            const pageHeight = 295;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;
            let heightLeft = imgHeight;

            let position = 0;

            pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;

            while (heightLeft >= 0) {
                position = heightLeft - imgHeight;
                pdf.addPage();
                pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;
            }

            const fileName = `Rapport_${monthName}_${year}_${new Date().getTime()}.pdf`;
            pdf.save(fileName);

            this.showNotification('Rapport PDF généré avec succès !', 'success');

        } catch (error) {
            console.error('Erreur lors de la génération du PDF:', error);
            this.showNotification('Erreur lors de la génération du PDF', 'error');
        }
    }

    getMonthlyStats() {
        const monthlyPayments = this.getMonthlyPayments();
        const collected = monthlyPayments.reduce((sum, p) => sum + p.amount, 0);

        const expected = this.members.reduce((sum, member) => {
            return sum + (member.monthlyQuota || 0);
        }, 0);

        const progressRate = expected > 0 ? (collected / expected) * 100 : 0;

        const paidMemberIds = new Set(monthlyPayments.map(p => p.memberId));
        const paidMembers = paidMemberIds.size;

        return {
            collected,
            expected,
            progressRate,
            paidMembers,
            totalMembers: this.members.length
        };
    }

    getMonthlyPayments() {
        return this.payments.filter(payment => {
            const paymentDate = new Date(payment.date);
            return paymentDate.getMonth() === this.currentMonth &&
                   paymentDate.getFullYear() === this.currentYear;
        });
    }

    showNotification(message, type = 'info') {

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
                <span>${message}</span>
            </div>
        `;

        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#27AE60' : type === 'error' ? '#E74C3C' : '#3498DB'};
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1000;
            transform: translateX(100%);
            transition: transform 0.3s ease;
            font-family: 'Inter', sans-serif;
            min-width: 300px;
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 100);

        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (document.body.contains(notification)) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    showLoader(message = 'Chargement...') {
        try {
            const el = document.getElementById('globalLoader');
            if (!el) return;
            const msg = el.querySelector('.loader-message');
            if (msg) msg.textContent = message;
            el.classList.remove('hidden');
        } catch (e) { console.warn('showLoader error', e); }
    }

    hideLoader() {
        try {
            const el = document.getElementById('globalLoader');
            if (!el) return;
            el.classList.add('hidden');
        } catch (e) { console.warn('hideLoader error', e); }
    }

    init() {
        this.loadFromFirebase();
        this.setupEventListeners();
        this.setupMemberEventListeners();
        this.updateUI();
        this.updateStats();
        this.populateFilters();
    }



renderLotMembersNew(membersWithLot, lot) {
    const container = document.getElementById('lotMembersList');

    if (membersWithLot.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-users"></i>
                <h3>Aucun membre assigné</h3>
                <p>Ce lot n'a pas encore de membres participants.</p>
                <div class="lot-card-preview">
                    <div class="lot-header">
                        <h4 class="lot-name">${lot.name}</h4>
                        <span class="lot-price">${this.formatCurrency(lot.price)}</span>
                    </div>
                    <div class="lot-details">
                        <div class="lot-description">${lot.description}</div>
                        <div class="lot-location">📍 ${lot.location}</div>
                        <div class="lot-members">👥 ${membersWithLot.length} membre(s)</div>
                    </div>
                    <div class="lot-members-list">
                        <span class="no-members">Aucun membre assigné</span>
                    </div>
                </div>
                <button class="btn btn-primary" onclick="paymentManager.switchTab('members')">
                    <i class="fas fa-plus"></i> Ajouter des membres
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="lot-card-detail">
            <div class="lot-header">
                <h4 class="lot-name">${lot.name}</h4>
                <span class="lot-price">${this.formatCurrency(lot.price)}</span>
            </div>
            <div class="lot-details">
                <div class="lot-description">${lot.description}</div>
                <div class="lot-location">📍 ${lot.location}</div>
                <div class="lot-members">👥 ${membersWithLot.length} membre(s)</div>
            </div>
            <div class="lot-members-list">
                ${membersWithLot.map(member => {
                    const memberPayments = this.payments.filter(p => p.memberId === member.id);
                    const totalPaid = memberPayments.reduce((sum, p) => sum + p.amount, 0);
                    const progress = member.monthlyQuota ? (totalPaid / (member.monthlyQuota * member.duration)) * 100 : 0;

                    return `
                        <div class="member-tag-detailed">
                            <div class="member-tag-info">
                                <span class="member-name">${member.name}</span>
                                <span class="member-quota">${this.formatCurrency(member.monthlyQuota || 0)}/mois</span>
                            </div>
                            <div class="member-progress-mini">
                                <div class="progress-bar-mini">
                                    <div class="progress-fill-mini" style="width: ${Math.min(progress, 100)}%"></div>
                                </div>
                                <span class="progress-text-mini">${Math.round(progress)}%</span>
                            </div>
                            <div class="member-status-mini ${progress >= 100 ? 'completed' : progress > 0 ? 'active' : 'pending'}">
                                ${progress >= 100 ? 'Terminé' : progress > 0 ? 'En cours' : 'En attente'}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

renderLotMembersTemp(members, lotName) {
    const container = document.getElementById('lotMembersList');

    if (members.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-users"></i>
                <h3>Aucun membre</h3>
                <p>Aucun membre n'a été créé dans le système.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="temp-notice">
            <i class="fas fa-info-circle"></i>
            <p><strong>Note :</strong> Affichage temporaire de tous les membres.
            Les membres ne sont pas encore liés aux lots spécifiques.</p>
        </div>
    ` + members.map(member => {
        const memberPayments = this.payments.filter(p => p.memberId === member.id);
        const totalPaid = memberPayments.reduce((sum, p) => sum + p.amount, 0);
        const progress = member.monthlyQuota ? (totalPaid / (member.monthlyQuota * member.duration)) * 100 : 0;

        return `
            <div class="lot-member-item">
                <div class="lot-member-avatar">
                    ${member.name.charAt(0).toUpperCase()}
                </div>
                <div class="lot-member-info">
                    <div class="lot-member-name">${member.name}</div>
                    <div class="lot-member-details">
                        <span class="member-quota">${this.formatCurrency(member.monthlyQuota || 0)}/mois</span>
                        <span class="member-duration">${member.duration || 0} mois</span>
                    </div>
                    <div class="member-progress">
                        <div class="progress-bar-small">
                            <div class="progress-fill-small" style="width: ${Math.min(progress, 100)}%"></div>
                        </div>
                        <span class="progress-text">${Math.round(progress)}%</span>
                    </div>
                </div>
                <div class="lot-member-stats">
                    <div class="member-stat">
                        <span class="stat-label">Total Payé</span>
                        <span class="stat-value">${this.formatCurrency(totalPaid)}</span>
                    </div>
                    <div class="member-status ${progress >= 100 ? 'completed' : progress > 0 ? 'active' : 'pending'}">
                        ${progress >= 100 ? 'Terminé' : progress > 0 ? 'En cours' : 'En attente'}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}
renderLotMembers(members) {
    const container = document.getElementById('lotMembersList');

    if (members.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-users"></i>
                <h3>Aucun membre inscrit</h3>
                <p>Ce lot n'a pas encore de membres participants.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = members.map(member => {
        const memberPayments = this.payments.filter(p => p.memberId === member.id);
        const totalPaid = memberPayments.reduce((sum, p) => sum + p.amount, 0);
        const progress = member.monthlyQuota ? (totalPaid / (member.monthlyQuota * member.duration)) * 100 : 0;

        return `
            <div class="lot-member-item">
                <div class="lot-member-avatar">
                    ${member.name.charAt(0).toUpperCase()}
                </div>
                <div class="lot-member-info">
                    <div class="lot-member-name">${member.name}</div>
                    <div class="lot-member-details">
                        <span class="member-quota">${this.formatCurrency(member.monthlyQuota)}/mois</span>
                        <span class="member-duration">${member.duration} mois</span>
                    </div>
                    <div class="member-progress">
                        <div class="progress-bar-small">
                            <div class="progress-fill-small" style="width: ${Math.min(progress, 100)}%"></div>
                        </div>
                        <span class="progress-text">${Math.round(progress)}%</span>
                    </div>
                </div>
                <div class="lot-member-stats">
                    <div class="member-stat">
                        <span class="stat-label">Total Payé</span>
                        <span class="stat-value">${this.formatCurrency(totalPaid)}</span>
                    </div>
                    <div class="member-status ${progress >= 100 ? 'completed' : progress > 0 ? 'active' : 'pending'}">
                        ${progress >= 100 ? 'Terminé' : progress > 0 ? 'En cours' : 'En attente'}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

    setupEventListeners() {

document.querySelectorAll('.btn-receipt').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        if (!id) return;
        this.exportPaymentReceipt(id);
    });
});

        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const tab = e.currentTarget.dataset.tab;
                this.switchTab(tab);
            });
        });

document.querySelectorAll('.btn-receipt').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        if (!id) return;
        this.exportPaymentReceipt(id);
    });
});

        document.addEventListener('click', (e) => {
    if (e.target.matches('.lot-pdf-btn') || e.target.closest('.lot-pdf-btn')) {
        const button = e.target.matches('.lot-pdf-btn') ? e.target : e.target.closest('.lot-pdf-btn');
        const lotId = button.dataset.lotId;
        this.exportLotToPDF(lotId);
    }
});

document.addEventListener('click', (e) => {
    if (e.target.matches('.member-pdf-btn') || e.target.closest('.member-pdf-btn')) {
        e.preventDefault();
        const button = e.target.matches('.member-pdf-btn') ? e.target : e.target.closest('.member-pdf-btn');
        const memberId = button.dataset.memberId;
        this.exportMemberToPDF(memberId);
    }
});

document.getElementById('lotDetailsClose').addEventListener('click', () => {
    this.closeLotDetailsModal();
});

document.addEventListener('click', (e) => {
    if (e.target.matches('.lot-view-btn') || e.target.closest('.lot-view-btn')) {
        const button = e.target.matches('.lot-view-btn') ? e.target : e.target.closest('.lot-view-btn');
        const lotId = button.dataset.lotId;
        this.showLotDetails(lotId);
    }
});

document.getElementById('lotDetailsModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        this.closeLotDetailsModal();
    }
});

document.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
        const targetTab = e.currentTarget.dataset.lotTab;

        document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.lot-tab-content').forEach(c => c.classList.remove('active'));

        e.currentTarget.classList.add('active');
        document.getElementById(`lotTab${targetTab.charAt(0).toUpperCase() + targetTab.slice(1)}`).classList.add('active');
    });
});
        document.getElementById('prevMonth').addEventListener('click', () => {
            this.changeMonth(-1);
        });
        document.getElementById('nextMonth').addEventListener('click', () => {
            this.changeMonth(1);
        });

        document.getElementById('addMemberBtn').addEventListener('click', () => {
            this.showAddMemberModal();
        });
        document.getElementById('addPaymentBtn').addEventListener('click', () => {
            this.showAddPaymentModal();
        });
        const editLotPriceBtn = document.getElementById('editLotPriceBtn');
        if (editLotPriceBtn) {
            editLotPriceBtn.addEventListener('click', () => {
                if (this.lots.length > 0) {
                    this.editLotPrice(this.lots[0].id);
                } else {
                    this.showNotification('Aucun lot configuré. Veuillez d\'abord créer un lot.', 'error');
                }
            });
        }
        const editUnitPriceBtn = document.getElementById('editUnitPriceBtn');
        if (editUnitPriceBtn) {
            editUnitPriceBtn.addEventListener('click', () => {
                const modal = document.getElementById('editUnitPriceModal');
                const input = document.getElementById('editUnitPrice');
                if (input) input.value = this.getUnitPrice() || '';
                if (modal) {
                    try { window._lastScrollY = window.scrollY || window.pageYOffset || 0; } catch (e) {}
                    modal.classList.add('active');
                    try { document.body.classList.add('modal-open'); } catch (e) {}
                }

                const saveBtn = document.getElementById('editUnitPriceSaveBtn');
                const cancelBtn = document.getElementById('editUnitPriceCancelBtn');
                const closeBtn = document.getElementById('editUnitPriceClose');

                const cleanup = () => {
                    if (modal) {
                        modal.classList.remove('active');
                        try { document.body.classList.remove('modal-open'); } catch (e) {}
                        try { const y = window._lastScrollY || 0; window.scrollTo({ top: y, behavior: 'smooth' }); window._lastScrollY = null; } catch (e) {}
                    }
                    if (saveBtn) saveBtn.removeEventListener('click', handleSave);
                    if (cancelBtn) cancelBtn.removeEventListener('click', handleCancel);
                    if (closeBtn) closeBtn.removeEventListener('click', handleCancel);
                };

                const handleCancel = () => { cleanup(); };

                const handleSave = () => {
                    const newPrice = parseFloat(input.value);
                    if (isNaN(newPrice) || newPrice < 0) {
                        this.showToast('Veuillez entrer un prix valide', 'error');
                        return;
                    }
                    this.config = this.config || {};
                    this.config.unitPrice = newPrice;
                    this.saveConfig();

                    try {
                        this.members = (this.members || []).map(member => {
                            const num = parseInt(member.numberOfLots) || 1;
                            const duration = parseInt(member.paymentDuration || member.duration) || 0;
                            const total = num * newPrice;
                            const monthly = duration > 0 ? Math.round((total / duration) / 100) * 100 : 0;
                            member.unitPrice = newPrice;
                            member.totalLotAmount = total;
                            member.monthlyQuota = monthly;
                            member.duration = duration || member.duration;
                            return member;
                        });
                        this.saveMembers();
                    } catch (err) {
                        console.error('Erreur en recalculant les membres après modification du prix global :', err);
                    }

                    this.renderLots();
                    this.renderMembers();
                    this.updateDashboard();
                    this.showToast('Prix unitaire global mis à jour', 'success');
                    cleanup();
                };

                if (cancelBtn) cancelBtn.addEventListener('click', handleCancel);
                if (closeBtn) closeBtn.addEventListener('click', handleCancel);
                if (saveBtn) saveBtn.addEventListener('click', handleSave);
            });
        }
        const exportPDFBtn = document.getElementById('exportPDF');
        if (exportPDFBtn) exportPDFBtn.addEventListener('click', () => { this.generateStyledMonthlyReport(); });

        const exportPaymentsPDFBtn = document.getElementById('exportPaymentsPDF');
        if (exportPaymentsPDFBtn) exportPaymentsPDFBtn.addEventListener('click', () => { this.exportPaymentsToPDF(); });

        const viewAllPaymentsBtn = document.getElementById('viewAllPayments');
        if (viewAllPaymentsBtn) viewAllPaymentsBtn.addEventListener('click', () => { this.switchTab('payments'); });

        const exportStatsBtn = document.getElementById('exportStatsBtn');
        if (exportStatsBtn) exportStatsBtn.addEventListener('click', () => { this.exportStatistics(); });

        const statsYearFilter = document.getElementById('statsYearFilter');
        if (statsYearFilter) statsYearFilter.addEventListener('change', () => { this.updateStatistics(); });

        const modalCloseBtn = document.getElementById('modalClose');
        if (modalCloseBtn) modalCloseBtn.addEventListener('click', () => { this.closeModal(); });

        // Clic sur l'overlay désactivé pour éviter fermeture accidentelle
        // const modalOverlayEl = document.getElementById('modalOverlay');
        // if (modalOverlayEl) modalOverlayEl.addEventListener('click', (e) => { if (e.target === e.currentTarget) this.closeModal(); });

        const memberSearchEl = document.getElementById('memberSearch');
        if (memberSearchEl) memberSearchEl.addEventListener('input', () => { this.renderMembers(); });

        const memberStatusFilterEl = document.getElementById('memberStatusFilter');
        if (memberStatusFilterEl) memberStatusFilterEl.addEventListener('change', () => { this.renderMembers(); });

        const memberUnpaidMonthsFilterEl = document.getElementById('memberUnpaidMonthsFilter');
        if (memberUnpaidMonthsFilterEl) memberUnpaidMonthsFilterEl.addEventListener('change', () => { this.renderMembers(); });

        const condensedBtn = document.getElementById('toggleCondensedMembers');
        if (condensedBtn) {
            const refreshCondensedLabel = () => {
                condensedBtn.textContent = this.membersCondensed ? 'Mode condensé : ON' : 'Mode condensé : OFF';
                condensedBtn.classList.toggle('active', this.membersCondensed);
            };
            refreshCondensedLabel();
            condensedBtn.addEventListener('click', () => {
                this.membersCondensed = !this.membersCondensed;
                safeSetItem('membersCondensed', this.membersCondensed);
                refreshCondensedLabel();
                this.renderMembers();
            });
        }

        // Selection delegation is attached in setupMemberEventListeners via attachSelectionDelegation().

        const bulkExportSelected = document.getElementById('bulkExportSelected');
        if (bulkExportSelected) bulkExportSelected.addEventListener('click', () => {
            if (this.selectedMembers.size === 0) return this.showNotification('Aucun membre sélectionné', 'error');
            this.selectedMembers.forEach(id => this.generateMemberDetailedReport(id));
        });

        const bulkDeleteSelected = document.getElementById('bulkDeleteSelected');
        if (bulkDeleteSelected) bulkDeleteSelected.addEventListener('click', () => {
            if (this.selectedMembers.size === 0) return this.showNotification('Aucun membre sélectionné', 'error');
            if (!confirm('Supprimer les membres sélectionnés ?')) return;
            this.selectedMembers.forEach(id => this.deleteMember(id));
            this.selectedMembers.clear();
            safeSetItem('selectedMembers', JSON.stringify(Array.from(this.selectedMembers)));
            this.renderMembers();
        });

        const bulkMarkPaidSelected = document.getElementById('bulkMarkPaidSelected');
        if (bulkMarkPaidSelected) bulkMarkPaidSelected.addEventListener('click', () => {
            if (this.selectedMembers.size === 0) return this.showNotification('Aucun membre sélectionné', 'error');

            const now = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jui', 'Jui', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

            const months = [];
            for (let i = 0; i < 12; i++) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const y = d.getFullYear();
                const m = pad(d.getMonth());
                const label = `${monthNames[d.getMonth()]} ${y}`;
                months.push({ key: `${y}-${m}`, label });
            }

            // build members table rows
            const selectedMembersArray = Array.from(this.selectedMembers).map(id => this.members.find(m => String(m.id) === String(id))).filter(Boolean);

            const membersRowsHtml = selectedMembersArray.map(m => `
                <tr data-member-id="${m.id}">
                    <td style="padding:6px 8px">${m.name}</td>
                    <td style="padding:6px 8px;text-align:right"><input type="number" class="override-amount" data-member-id="${m.id}" step="0.01" style="width:110px" placeholder="Montant" /></td>
                </tr>
            `).join('');

            const monthsHtml = months.map((mo, idx) => `
                <label style="display:block;margin:4px 0;"><input type="checkbox" class="bulk-month-checkbox" value="${mo.key}" ${idx===0? 'checked' : ''}/> ${mo.label}</label>
            `).join('');

            const modalContent = `
                <div class="bulk-pay-advanced" style="display:flex;gap:12px;">
                    <div style="flex:0 0 280px">
                        <h4>Sélectionner les mois</h4>
                        <div style="max-height:260px;overflow:auto;border:1px solid #eee;padding:8px;margin-bottom:8px;">${monthsHtml}</div>
                        <label>Montant global (laisser vide pour utiliser le prix unitaire):<br><input id="bulkPayAmountGlobal" type="number" step="0.01" style="width:140px;margin-top:6px" /></label>
                        <div style="margin-top:8px">
                            <label><input type="radio" name="bulkMode" value="skip" checked/> Ne pas dupliquer (skip)</label><br>
                            <label><input type="radio" name="bulkMode" value="replace"/> Remplacer existants</label><br>
                            <label><input type="radio" name="bulkMode" value="duplicate"/> Créer doublons</label>
                        </div>
                        <div style="margin-top:12px">
                            <button class="btn btn-secondary" onclick="paymentManager.closeModal()">Annuler</button>
                            <button class="btn btn-info" id="bulkPreviewBtn">Aperçu</button>
                        </div>
                    </div>
                    <div style="flex:1;min-width:360px">
                        <h4>Aperçu et overrides</h4>
                        <div style="max-height:300px;overflow:auto;border:1px solid #eee;padding:8px;margin-bottom:8px;">
                            <table style="width:100%;border-collapse:collapse"> 
                                <thead><tr><th style="text-align:left">Membre</th><th style="text-align:right">Montant (override)</th></tr></thead>
                                <tbody id="bulkMembersTable">${membersRowsHtml}</tbody>
                            </table>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center">
                            <div><strong id="bulkPreviewInfo">0 paiements - Total: 0</strong></div>
                            <div>
                                <button class="btn btn-primary" id="confirmBulkPayAdvanced">Confirmer</button>
                            </div>
                        </div>
                        <div id="bulkProgress" style="display:none;margin-top:8px">
                            <div style="background:#eee;height:12px;border-radius:6px;overflow:hidden"><div id="bulkProgressBar" style="height:12px;background:#27AE60;width:0%"></div></div>
                            <div id="bulkProgressText" style="font-size:0.85em;margin-top:6px"></div>
                        </div>
                    </div>
                </div>
            `;

            this.showModal('Paiement en masse avancé', modalContent);

            setTimeout(() => {
                const getSelectedMonths = () => Array.from(document.querySelectorAll('.bulk-month-checkbox:checked')).map(i => i.value);
                const getGlobalAmount = () => { const v = document.getElementById('bulkPayAmountGlobal'); return v && v.value ? parseFloat(v.value) : null; };
                const getMode = () => { const r = document.querySelector('input[name="bulkMode"]:checked'); return r ? r.value : 'skip'; };

                const computePreview = () => {
                    const months = getSelectedMonths();
                    const globalAmt = getGlobalAmount();
                    let total = 0; let count = 0;
                    const rows = Array.from(document.querySelectorAll('.override-amount'));
                    rows.forEach(r => {
                        const id = r.dataset.memberId; const val = r.value ? parseFloat(r.value) : null;
                        const amt = val != null && !isNaN(val) ? val : (globalAmt != null && !isNaN(globalAmt) ? globalAmt : this.getUnitPrice());
                        count += months.length;
                        total += amt * months.length;
                    });
                    const info = document.getElementById('bulkPreviewInfo');
                    if (info) info.textContent = `${count} paiements - Total: ${this.formatCurrency(total)}`;
                };

                document.getElementById('bulkPreviewBtn').addEventListener('click', () => computePreview());

                // update preview when inputs change
                document.getElementById('bulkMembersTable').addEventListener('input', () => computePreview());
                document.querySelectorAll('.bulk-month-checkbox, #bulkPayAmountGlobal').forEach(el => el.addEventListener('change', () => computePreview()));

                // month checkboxes only update preview; apply is done via 'Aperçu' + 'Confirmer'

                // initial preview
                computePreview();

                const confirmBtn = document.getElementById('confirmBulkPayAdvanced');
                confirmBtn.addEventListener('click', async () => {
                    const months = getSelectedMonths();
                    if (months.length === 0) return this.showNotification('Aucun mois sélectionné', 'error');
                    const mode = getMode();
                    const globalAmt = getGlobalAmount();

                    const memberInputs = Array.from(document.querySelectorAll('.override-amount')).map(i => ({ id: i.dataset.memberId, val: i.value ? parseFloat(i.value) : null }));

                    const tasks = [];
                    selectedMembersArray.forEach(m => {
                        const override = memberInputs.find(mi => String(mi.id) === String(m.id));
                        const baseAmt = override && override.val != null && !isNaN(override.val) ? override.val : (globalAmt != null && !isNaN(globalAmt) ? globalAmt : this.getUnitPrice());
                        months.forEach(monthKey => {
                            tasks.push({ memberId: String(m.id), monthKey, amount: baseAmt });
                        });
                    });

                    // process with progress
                    const progressEl = document.getElementById('bulkProgress');
                    const progressBar = document.getElementById('bulkProgressBar');
                    const progressText = document.getElementById('bulkProgressText');
                    if (progressEl) progressEl.style.display = 'block';

                    for (let i = 0; i < tasks.length; i++) {
                        const t = tasks[i];
                        const existsIdx = this.payments.findIndex(p => p.memberId === t.memberId && p.monthKey === t.monthKey);
                        if (existsIdx !== -1) {
                            if (mode === 'skip') {
                                // skip
                            } else if (mode === 'replace') {
                                this.payments[existsIdx].amount = t.amount;
                                this.payments[existsIdx].date = new Date().toISOString();
                            } else if (mode === 'duplicate') {
                                this.payments.push({ id: this.generateId(), memberId: t.memberId, amount: t.amount, date: new Date().toISOString(), monthKey: t.monthKey });
                            }
                        } else {
                            this.payments.push({ id: this.generateId(), memberId: t.memberId, amount: t.amount, date: new Date().toISOString(), monthKey: t.monthKey });
                        }

                        const pct = Math.round(((i+1)/tasks.length)*100);
                        if (progressBar) progressBar.style.width = pct + '%';
                        if (progressText) progressText.textContent = `${i+1} / ${tasks.length} traités`;
                        // allow UI to update
                        await new Promise(r => setTimeout(r, 10));
                    }

                    this.savePayments();
                    this.showNotification('Paiements en masse traités', 'success');
                    this.selectedMembers.clear();
                    safeSetItem('selectedMembers', JSON.stringify(Array.from(this.selectedMembers)));
                    this.closeModal();
                    this.renderMembers();
                });
            }, 100);
        });

        const bulkMarkSoldSelected = document.getElementById('bulkMarkSoldSelected');
        if (bulkMarkSoldSelected) bulkMarkSoldSelected.addEventListener('click', () => {
            if (this.selectedMembers.size === 0) return this.showNotification('Aucun membre sélectionné', 'error');
            this.selectedMembers.forEach(id => {
                const member = this.members.find(m => m.id === id);
                if (member) member.sold = true;
            });
            this.saveMembers();
            this.showNotification('Membres marqués soldés', 'success');
            this.selectedMembers.clear();
            safeSetItem('selectedMembers', JSON.stringify(Array.from(this.selectedMembers)));
            this.renderMembers();
        });

        document.getElementById('paymentSearch').addEventListener('input', () => {
            this.renderPayments();
        });
        // lotSearch supprimé avec le nouveau design de Gestion des Lots
        document.getElementById('monthFilter').addEventListener('change', () => {
            this.renderPayments();
        });
        document.getElementById('memberFilter').addEventListener('change', () => {
            this.renderPayments();
        });

        // Payments range filter (start/end month) - Apply / Reset
        const applyRangeBtn = document.getElementById('applyPaymentsRange');
        const resetRangeBtn = document.getElementById('resetPaymentsRange');
        const startEl = document.getElementById('paymentStartMonth');
        const endEl = document.getElementById('paymentEndMonth');
        if (applyRangeBtn) applyRangeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const start = startEl && startEl.value ? startEl.value : null;
            const end = endEl && endEl.value ? endEl.value : null;
            if (start && end) {
                const [sy, sm] = start.split('-').map(s=>parseInt(s,10));
                const [ey, em] = end.split('-').map(s=>parseInt(s,10));
                const monthsDiff = (ey - sy) * 12 + (em - sm) + 1;
                if (monthsDiff <= 0) { this.showNotification('La date de fin doit être après la date de début', 'error'); return; }
                if (monthsDiff > 12) { this.showNotification('La période ne peut pas dépasser 12 mois', 'error'); return; }
            }
            // re-render with applied range
            this.renderPayments();
        });
        if (resetRangeBtn) resetRangeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (startEl) startEl.value = '';
            if (endEl) endEl.value = '';
            this.renderPayments();
        });

    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {

            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

            e.currentTarget.classList.add('active');

            const tabName = e.currentTarget.dataset.tab;
            this.switchTab(tabName);
        });
    });
    }

setupMemberEventListeners() {
    const membersGrid = document.getElementById('membersGrid');

    membersGrid.addEventListener('click', (e) => {
        const target = e.target;

        if (target.matches('.member-add-payment')) {
            e.preventDefault();
            const memberId = target.dataset.memberId;
            this.showAddPaymentModal(memberId);
            return;
        }

        if (target.matches('.member-edit')) {
            e.preventDefault();
            const memberId = target.dataset.memberId;
            this.showEditMemberModal(memberId);
            return;
        }

        if (target.matches('.member-delete')) {
            e.preventDefault();
            const memberId = target.dataset.memberId;
            if (confirm('Êtes-vous sûr de vouloir supprimer ce membre ?')) {
                this.deleteMember(memberId);
            }
            return;
        }
        // Do not call preventDefault() for other clicks (e.g. checkboxes)
    });
    // Ensure selection delegation is attached once
    this.attachSelectionDelegation();
}

    switchTab(tabName) {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(tabName).classList.add('active');

        this.currentTab = tabName;
        this.updateUI();
        this.populateMonthFilters();
    }

    updateUI() {
        switch (this.currentTab) {
            case 'dashboard':
                this.updateDashboard();
                break;
            case 'members':
                this.renderMembers();
                break;
            case 'payments':
                this.renderPayments();
                break;
            case 'lots':
                this.renderLots();
                break;
            case 'statistics':
                this.updateStatistics();
                break;
            case 'notifications':
                if (typeof renderNotificationsPage === 'function') {
                    renderNotificationsPage();
                }
                break;
        }
    }

    updateStats() {
        const totalMembers = this.members.length;
        const monthlyTotal = this.getMonthlyTotal();

        document.getElementById('totalMembers').textContent = totalMembers;
        document.getElementById('totalPayments').textContent = this.formatCurrency(monthlyTotal);
    }

    updateDashboard() {
        this.updateMonthDisplay();
        this.updateMonthlySummary();
        this.updateActivityStats();
        this.updateRecentPayments();
        this.updateRecentActions();
    }

    updateMonthDisplay() {
        const monthNames = [
            'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
            'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
        ];
        document.getElementById('currentMonth').textContent =
            `${monthNames[this.currentMonth]} ${this.currentYear}`;
    }

updateMonthlySummary() {
    const monthlyPayments = this.getMonthlyPayments();
    const totalCollected = monthlyPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const totalExpected = this.members.reduce((sum, member) => sum + (member.monthlyQuota || 0), 0);
    const completionRate = totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 100) : 0;

    const totalLotsValue = this.lots.reduce((sum, lot) => sum + lot.price, 0);

    document.getElementById('monthlyCollected').textContent = this.formatCurrency(totalCollected);
    document.getElementById('monthlyExpected').textContent = this.formatCurrency(totalExpected);
    document.getElementById('completionRate').textContent = `${completionRate}%`;
    document.getElementById('totalLotsValue').textContent = this.formatCurrency(totalLotsValue);

    const progressFill = document.getElementById('monthlyProgress');
    const progressPercentage = document.getElementById('progressPercentage');

    if (progressFill) {
        progressFill.style.width = `${Math.min(completionRate, 100)}%`;
    }

    if (progressPercentage) {
        progressPercentage.textContent = `${completionRate}%`;
    }

    const progressPercentage2 = document.getElementById('progressPercentage2');
    if (progressPercentage2) {
        progressPercentage2.textContent = `${completionRate}%`;
    }
}

    updateActivityStats() {
        const monthlyPayments = this.getMonthlyPayments();
        const paidMemberIds = new Set(monthlyPayments.map(p => p.memberId));
        const paidMembers = paidMemberIds.size;
        const pendingMembers = this.members.length - paidMembers;

        document.getElementById('paidMembers').textContent = paidMembers;
        document.getElementById('pendingMembers').textContent = pendingMembers;
    }

    updateRecentPayments() {
        const recentPayments = this.payments
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 5);

        const container = document.getElementById('recentPayments');

        if (recentPayments.length === 0) {
            container.innerHTML = '<div class="empty-state"><h3>Aucun paiement récent</h3></div>';
            return;
        }

        container.innerHTML = recentPayments.map(payment => {
            const member = this.members.find(m => m.id === payment.memberId);
            return `
                <div class="payment-item">
                    <div class="payment-avatar">
                        ${member ? member.name.charAt(0).toUpperCase() : '?'}
                    </div>
                    <div class="payment-info">
                        <div class="payment-name">${member ? member.name : 'Membre Inconnu'}</div>
                        <div class="payment-date">${this.formatDate(payment.date)}</div>
                    </div>
                    <div class="payment-amount">${this.formatCurrency(payment.amount)}</div>
                </div>
            `;
        }).join('');
    }

    updateRecentActions() {
        const actions = [];

        this.payments.slice(-5).forEach(payment => {
            const member = this.members.find(m => m.id === payment.memberId);
 actions.push({
    type: 'payment',
    date: payment.date,
    description: `Paiement de ${this.formatCurrency(payment.amount)} par ${member ? member.name : 'Membre Inconnu'}`,
    icon: '<i class="fas fa-dollar-sign"></i>'
});

actions.push({
    type: 'member',
    date: member.createdAt || new Date().toISOString(),
    description: `Nouveau membre ajouté: ${member.name}`,
    icon: '<i class="fas fa-user-plus"></i>'
});
        });

        actions.sort((a, b) => new Date(b.date) - new Date(a.date));

        const container = document.getElementById('recentActions');

        if (actions.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>Aucune action récente</p></div>';
            return;
        }

        container.innerHTML = actions.slice(0, 5).map(action => `
            <div class="action-item">
                <div class="action-icon">${action.icon}</div>
                <div class="action-content">
                    <div class="action-description">${action.description}</div>
                    <div class="action-date">${this.formatDate(action.date)}</div>
                </div>
            </div>
        `).join('');
    }

    changeMonth(direction) {
        this.currentMonth += direction;
        if (this.currentMonth < 0) {
            this.currentMonth = 11;
            this.currentYear--;
        } else if (this.currentMonth > 11) {
            this.currentMonth = 0;
            this.currentYear++;
        }
        this.updateDashboard();
    }

    renderMembersListView(filteredMembers) {
        const container = document.getElementById('membersGrid');
        if (!this.selectedMembers) {
            const stored = safeGetItem('selectedMembers');
            this.selectedMembers = stored ? new Set(JSON.parse(stored).map(String)) : new Set();
        }

        if (!this.memberSort) {
            const savedKey = localStorage.getItem('memberSortKey') || 'name';
            const savedDir = localStorage.getItem('memberSortDir') || 'asc';
            this.memberSort = { key: savedKey, dir: savedDir };
        }

        // Mode condensé (masquer les colonnes mois)
        if (this.membersCondensed === undefined) {
            const storedCondensed = localStorage.getItem('membersCondensed');
            this.membersCondensed = storedCondensed === 'true';
        }
        const showMonths = !this.membersCondensed;

        if (filteredMembers.length === 0) {
            container.innerHTML = '<div class="empty-state"><h3>Aucun membre trouvé</h3><p>Ajoutez un nouveau membre pour commencer</p></div>';
            return;
        }

        const sortedMembers = this.applyMemberSort([...filteredMembers]);
        const allVisibleSelected = sortedMembers.every(m => this.selectedMembers.has(String(m.id)));

        // Générer les 12 mois en commençant par juillet
        const months = [];
        const monthNames = ['jan', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
        for (let i = 0; i < 12; i++) {
            const monthIndex = (6 + i) % 12; // Commence à juillet (index 6)
            const year = 2025 + Math.floor((6 + i) / 12);
            const d = new Date(year, monthIndex, 1);
            const monthStr = monthNames[monthIndex];
            const yearStr = year.toString().slice(-2);
            months.push({ date: d, label: `${monthStr}-${yearStr}` });
        }

        // Totaux pour le pied de tableau
        const lotPrice = this.getUnitPrice();
        const totals = filteredMembers.reduce((acc, member) => {
            const lotsCount = member.numberOfLots || 1;
            const totalLotAmount = lotsCount * lotPrice;
            const memberPayments = this.payments.filter(p => p.memberId === member.id);
            const totalPaymentsAmount = memberPayments.reduce((sum, p) => sum + p.amount, 0);
            acc.totalLots += lotsCount;
            acc.totalDue += totalLotAmount;
            acc.totalPaid += totalPaymentsAmount;
            acc.totalRemaining += Math.max(0, totalLotAmount - totalPaymentsAmount);
            return acc;
        }, { totalLots: 0, totalDue: 0, totalPaid: 0, totalRemaining: 0 });

        let html = `
            <div class="table-container members-list-view">
                ${this.selectedMembers.size > 0 ? `
                    <div class="bulk-bar">
                        <div class="bulk-info">${this.selectedMembers.size} sélectionné(s)</div>
                        <div class="bulk-actions">
                            <button class="btn btn-secondary btn-small" id="bulkExportMembers">Exporter PDF</button>
                            <button class="btn btn-danger btn-small" id="bulkDeleteMembers">Supprimer</button>
                        </div>
                    </div>
                ` : ''}
                <table class="members-table">
                    <thead>
                        <tr>
                            <th class="cell-select"><input type="checkbox" id="selectAllMembers" ${allVisibleSelected ? 'checked' : ''}></th>
                            <th data-sort="name" class="sortable">NOM CLIENT <span class="sort-indicator">${this.memberSort.key === 'name' ? (this.memberSort.dir === 'asc' ? '▲' : '▼') : ''}</span></th>
                            <th data-sort="lots" class="sortable">Nbre <span class="sort-indicator">${this.memberSort.key === 'lots' ? (this.memberSort.dir === 'asc' ? '▲' : '▼') : ''}</span></th>
                            <th data-sort="amount" class="sortable">MONTANT <span class="sort-indicator">${this.memberSort.key === 'amount' ? (this.memberSort.dir === 'asc' ? '▲' : '▼') : ''}</span></th>
                            ${showMonths ? months.map(m => `<th class="month-cell">${m.label}</th>`).join('') : ''}
                            <th data-sort="totalPaid" class="sortable">MONTANT VERS <span class="sort-indicator">${this.memberSort.key === 'totalPaid' ? (this.memberSort.dir === 'asc' ? '▲' : '▼') : ''}</span></th>
                            <th data-sort="remaining" class="sortable">RESTE A PAYER <span class="sort-indicator">${this.memberSort.key === 'remaining' ? (this.memberSort.dir === 'asc' ? '▲' : '▼') : ''}</span></th>
                            <th data-sort="status" class="sortable">STATUT <span class="sort-indicator">${this.memberSort.key === 'status' ? (this.memberSort.dir === 'asc' ? '▲' : '▼') : ''}</span></th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        sortedMembers.forEach(member => {
            const memberPayments = this.payments.filter(p => p.memberId === member.id);
            const totalPaymentsAmount = memberPayments.reduce((sum, p) => sum + p.amount, 0);
            
            // Calcul de la mensualité de référence
            const lotPrice = this.getUnitPrice();
            const totalLotAmount = (member.numberOfLots || 1) * lotPrice;
            const paymentDuration = member.paymentDuration || 12;
            const monthlyDue = totalLotAmount / paymentDuration;
            
            // Répartition intelligente des paiements chronologiquement
            const monthPayments = {};
            
            // Trier les paiements par date chronologique
            const sortedPayments = [...memberPayments].sort((a, b) => new Date(a.date) - new Date(b.date));
            
            // Répartir les paiements sur les mois
            let remainingAmount = 0;
            sortedPayments.forEach(payment => {
                remainingAmount += payment.amount;
            });
            
            // Remplir chronologiquement : mois passés impayés → mois actuel → mois futurs
            let amountToDistribute = remainingAmount;
            months.forEach(m => {
                const monthKey = `${m.date.getFullYear()}-${m.date.getMonth()}`;
                
                if (amountToDistribute >= monthlyDue) {
                    // Mois payé à 100%
                    monthPayments[monthKey] = { amount: monthlyDue, percentage: 100 };
                    amountToDistribute -= monthlyDue;
                } else if (amountToDistribute > 0) {
                    // Mois payé partiellement
                    monthPayments[monthKey] = { 
                        amount: amountToDistribute, 
                        percentage: Math.round((amountToDistribute / monthlyDue) * 100) 
                    };
                    amountToDistribute = 0;
                } else {
                    // Mois non payé
                    monthPayments[monthKey] = { amount: 0, percentage: 0 };
                }
            });
            
            const remaining = Math.max(0, totalLotAmount - totalPaymentsAmount);
            const status = remaining <= 0 ? 'SOLDE' : 'NON-SOLDE';
            const statusColor = remaining <= 0 ? '#27AE60' : '#E74C3C';
            
            const isSelected = this.selectedMembers.has(String(member.id));
            const lotsCount = member.numberOfLots || 1;
            
            // Calculer le nombre de mois impayés
            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth();
            const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
            const currentDay = now.getDate();
            const daysUntilEndOfMonth = lastDayOfMonth - currentDay;
            
            let unpaidMonthsCount = 0;
            for (let i = 0; i < 12; i++) {
                const checkDate = new Date(currentYear, currentMonth - i, 1);
                const monthKey1 = `${checkDate.getFullYear()}-${checkDate.getMonth()}`;
                const monthKey2 = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}`;
                
                const hasPaid = sortedPayments.some(p => {
                    if (p.monthKey) {
                        return p.monthKey === monthKey1 || p.monthKey === monthKey2;
                    }
                    const paymentDate = new Date(p.date);
                    return paymentDate.getFullYear() === checkDate.getFullYear() && 
                           paymentDate.getMonth() === checkDate.getMonth();
                });
                
                if (!hasPaid) {
                    unpaidMonthsCount++;
                } else {
                    break; // Arrêter au premier mois payé
                }
            }
            
            const currentMonthKey1 = `${currentYear}-${currentMonth}`;
            const currentMonthKey2 = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
            
            const hasPayedCurrentMonth = sortedPayments.some(p => {
                if (p.monthKey) {
                    return p.monthKey === currentMonthKey1 || p.monthKey === currentMonthKey2;
                }
                const paymentDate = new Date(p.date);
                return paymentDate.getFullYear() === currentYear && paymentDate.getMonth() === currentMonth;
            });
            
            const showBell = !hasPayedCurrentMonth && daysUntilEndOfMonth <= 3;

            html += `
                <tr class="member-row" data-member-id="${member.id}">
                    <td class="cell-select"><input type="checkbox" class="member-select" data-member-id="${member.id}" ${this.selectedMembers.has(String(member.id)) ? 'checked' : ''}></td>
                    <td class="cell-name member-name-clickable" style="font-weight: 600; cursor: pointer; color: #181818;" data-member-id="${member.id}" title="Cliquez pour voir les détails">
                        ${showBell ? `<i class="fas fa-bell" style="color: #E74C3C; margin-right: 5px;" title="${unpaidMonthsCount} mois impayé${unpaidMonthsCount > 1 ? 's' : ''}"></i>` : ''}
                        ${member.name}
                    </td>
                    <td class="cell-center">${lotsCount}</td>
                    <td class="cell-amount" style="text-align: right; font-weight: 600;">${this.formatCurrency(totalLotAmount)}</td>
                    ${showMonths ? months.map(m => {
                        const monthKey = `${m.date.getFullYear()}-${m.date.getMonth()}`;
                        const monthData = monthPayments[monthKey] || { amount: 0, percentage: 0 };
                        
                        let bgColor, textColor, fontWeight, displayText;
                        
                        if (monthData.percentage === 100) {
                            // Mois payé à 100% : vert
                            bgColor = '#27AE60';
                            textColor = '#fff';
                            fontWeight = '600';
                            displayText = this.formatCurrency(monthData.amount);
                        } else if (monthData.percentage > 0 && monthData.percentage < 100) {
                            // Mois payé partiellement : orange avec montant + pourcentage
                            bgColor = '#FF9800';
                            textColor = '#fff';
                            fontWeight = '600';
                            displayText = `${this.formatCurrency(monthData.amount)} (${monthData.percentage}%)`;
                        } else {
                            // Mois non payé : gris clair
                            bgColor = '#E8F8F5';
                            textColor = '#7F8C8D';
                            fontWeight = '400';
                            displayText = '-';
                        }
                        
                        return `<td class="month-cell" style="text-align: center; background-color: ${bgColor}; font-weight: ${fontWeight}; color: ${textColor};">${displayText}</td>`;
                    }).join('') : ''}
                    <td class="cell-amount" style="text-align: right; color: #27AE60; font-weight: 600;">${this.formatCurrency(totalPaymentsAmount)}</td>
                    <td class="cell-amount" style="text-align: right; color: ${totalPaymentsAmount >= totalLotAmount ? '#27AE60' : '#E74C3C'}; font-weight: 600;">${this.formatCurrency(remaining)}</td>
                    <td class="cell-status" style="text-align: center; font-weight: 600; color: ${statusColor};">${status}</td>
                    <td class="cell-actions">
                        <div class="action-menu">
                            <button class="action-btn" title="Plus d'actions">⋮</button>
                            <div class="action-dropdown">
                                <button class="action-item" data-action="payment" data-member-id="${member.id}">
                                    <i class="fas fa-plus-circle"></i> Ajouter Paiement
                                </button>
                                <button class="action-item" data-action="pdf" data-member-id="${member.id}">
                                    <i class="fas fa-file-pdf"></i> Exporter PDF
                                </button>
                                <button class="action-item" data-action="delete" data-member-id="${member.id}">
                                    <i class="fas fa-trash"></i> Supprimer
                                </button>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                    <tfoot>
                        <tr class="totals-row" style="background:#f8f9fb; font-weight:700;">
                            <td></td>
                            <td style="text-transform:uppercase;">Total</td>
                            <td style="text-align:center;">${totals.totalLots}</td>
                            <td style="text-align:right;">${this.formatCurrency(totals.totalDue)}</td>
                            ${showMonths ? months.map(() => '<td></td>').join('') : ''}
                            <td style="text-align:right; color:#27AE60;">${this.formatCurrency(totals.totalPaid)}</td>
                            <td style="text-align:right; color:${totals.totalRemaining === 0 ? '#27AE60' : '#E74C3C'};">${this.formatCurrency(totals.totalRemaining)}</td>
                            <td colspan="2"></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;

        container.innerHTML = html;
        
        // Gestionnaires pour les noms de membres cliquables
        document.querySelectorAll('.member-name-clickable').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const memberId = el.getAttribute('data-member-id');
                this.generateMemberDetailedReport(memberId);
            });
        });
        
        // Sélection lignes
        // Re-attach handlers for table view selection (select-all + per-row)
        const updateStoredSelection = () => {
            safeSetItem('selectedMembers', JSON.stringify(Array.from(this.selectedMembers)));
            const bulkActions = document.getElementById('bulkExportMembers') || document.getElementById('membersBulkActions');
            const bar = document.getElementById('membersBulkActions');
            if (bar) bar.style.display = this.selectedMembers.size > 0 ? 'flex' : 'none';
        };

        // Sync UI checkboxes/rows from stored selection after rendering
        this.updateSelectionUI();

        const selectAll = container.querySelector('#selectAllMembers');
        if (selectAll) {
            const tableCheckboxes = container.querySelectorAll('.member-select, .member-select-checkbox');
            selectAll.checked = tableCheckboxes.length > 0 && Array.from(tableCheckboxes).every(c => c.checked);
            selectAll.addEventListener('change', () => {
                if (selectAll.checked) {
                    sortedMembers.forEach(m => this.selectedMembers.add(String(m.id)));
                } else {
                    sortedMembers.forEach(m => this.selectedMembers.delete(String(m.id)));
                }
                updateStoredSelection();
                this.renderMembersListView(filteredMembers);
            });
        }

        // Boutons bulk
        const bulkExport = container.querySelector('#bulkExportMembers');
        if (bulkExport) {
            bulkExport.addEventListener('click', () => {
                this.selectedMembers.forEach(id => this.generateMemberDetailedReport(id));
            });
        }
        const bulkDelete = container.querySelector('#bulkDeleteMembers');
        if (bulkDelete) {
            bulkDelete.addEventListener('click', () => {
                if (!confirm('Supprimer les éléments sélectionnés ?')) return;
                this.selectedMembers.forEach(id => this.deleteMember(id));
                this.selectedMembers.clear();
                updateStoredSelection();
                this.renderMembers();
            });
        }

        // Tri des colonnes
        container.querySelectorAll('.members-table th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const key = th.getAttribute('data-sort');
                if (this.memberSort.key === key) {
                    this.memberSort.dir = this.memberSort.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    this.memberSort = { key, dir: 'asc' };
                }
                localStorage.setItem('memberSortKey', this.memberSort.key);
                localStorage.setItem('memberSortDir', this.memberSort.dir);
                this.renderMembers();
            });
        });

        // Progress popover
        container.querySelectorAll('.progress-cell').forEach(cell => {
            cell.addEventListener('click', (e) => {
                const memberId = cell.dataset.memberId;
                const member = this.members.find(m => m.id === memberId);
                this.showProgressPopover(e.currentTarget, member);
            });
        });

        // Ajouter les événements des menus d'actions
        this.setupTableActions();
    }

    setupTableActions() {
        // Utiliser une délégation d'événements (attachée une seule fois)
        if (this._actionMenusDelegated) return;
        this._actionMenusDelegated = true;

        document.addEventListener('click', (e) => {
            // Bouton d'ouverture du menu
            const btn = e.target.closest('.action-btn');
            if (btn) {
                e.stopPropagation();
                const menu = btn.nextElementSibling;
                document.querySelectorAll('.action-dropdown.active').forEach(m => {
                    if (m !== menu) m.classList.remove('active');
                });
                if (menu) menu.classList.toggle('active');
                return;
            }

            // Item du menu
            const item = e.target.closest('.action-item');
            if (item) {
                e.stopPropagation();
                const action = item.dataset.action;
                const memberId = item.dataset.memberId;
                const lotId = item.dataset.lotId;

                if (memberId) {
                    if (action === 'payment') {
                        this.showAddPaymentModal(memberId);
                    } else if (action === 'pdf') {
                        if (typeof this.generateMemberDetailedReport === 'function') this.generateMemberDetailedReport(memberId);
                        else if (typeof this.exportMemberToPDF === 'function') this.exportMemberToPDF(memberId);
                    } else if (action === 'delete') {
                        if (confirm('Êtes-vous sûr de vouloir supprimer ce membre ?')) {
                            this.deleteMember(memberId);
                        }
                    }
                } else if (lotId) {
                    if (action === 'edit') {
                        this.editLot(lotId);
                    } else if (action === 'pdf') {
                        this.exportLotToPDF(lotId);
                    } else if (action === 'delete') {
                        if (confirm('Êtes-vous sûr de vouloir supprimer ce lot ?')) {
                            this.deleteLot(lotId);
                        }
                    }
                }

                const dropdown = item.closest('.action-menu') && item.closest('.action-menu').querySelector('.action-dropdown');
                if (dropdown) dropdown.classList.remove('active');
                return;
            }

            // Clic en dehors : fermer tous les dropdowns
            if (!e.target.closest('.action-menu')) {
                document.querySelectorAll('.action-dropdown.active').forEach(m => m.classList.remove('active'));
            }
        });
    }

    renderMembers() {
        const container = document.getElementById('membersGrid');
        const searchTerm = document.getElementById('memberSearch').value.toLowerCase();
        const statusFilter = document.getElementById('memberStatusFilter').value;
        const unpaidMonthsFilter = document.getElementById('memberUnpaidMonthsFilter').value;

        let filteredMembers = this.members;

        if (searchTerm) {
            filteredMembers = filteredMembers.filter(member =>
                (member.name || '').toLowerCase().includes(searchTerm) ||
                (member.email || '').toLowerCase().includes(searchTerm) ||
                (member.phone || '').includes(searchTerm)
            );
        }

        if (statusFilter) {
            filteredMembers = filteredMembers.filter(member => {
                const lotsCount = member.numberOfLots || 1;
                const lotPrice = this.getUnitPrice();
                const totalLotAmount = lotsCount * lotPrice;
                const memberPayments = this.payments.filter(p => p.memberId === member.id);
                const totalPaid = memberPayments.reduce((sum, p) => sum + p.amount, 0);
                const remaining = totalLotAmount - totalPaid;
                
                const isSolde = remaining <= 0;
                return statusFilter === 'solde' ? isSolde : !isSolde;
            });
        }
        
        // Filtre par nombre de derniers mois impayés
        if (unpaidMonthsFilter) {
            const minUnpaidMonths = parseInt(unpaidMonthsFilter, 10);
            filteredMembers = filteredMembers.filter(member => {
                const memberPayments = this.payments.filter(p => p.memberId === member.id);
                const now = new Date();
                let unpaidConsecutiveCount = 0;
                
                // Compter les mois impayés consécutifs depuis le mois actuel
                for (let i = 0; i < 12; i++) {
                    const checkDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
                    const monthKey1 = `${checkDate.getFullYear()}-${checkDate.getMonth()}`;
                    const monthKey2 = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}`;
                    
                    const hasPaid = memberPayments.some(p => {
                        if (p.monthKey) {
                            return p.monthKey === monthKey1 || p.monthKey === monthKey2;
                        }
                        const paymentDate = new Date(p.date);
                        return paymentDate.getFullYear() === checkDate.getFullYear() && 
                               paymentDate.getMonth() === checkDate.getMonth();
                    });
                    
                    if (!hasPaid) {
                        unpaidConsecutiveCount++;
                    } else {
                        break; // S'arrêter au premier mois payé
                    }
                }
                
                // Afficher si le nombre de mois impayés est >= au filtre sélectionné
                return unpaidConsecutiveCount >= minUnpaidMonths;
            });
        }

        // Vérifier si la vue liste est activée
        const membersGrid = document.getElementById('membersGrid');
        const isListView = membersGrid.classList.contains('list-view');

        if (isListView) {
            this.renderMembersListView(filteredMembers);
            return;
        }

        if (filteredMembers.length === 0) {
            container.innerHTML = '<div class="empty-state"><h3>Aucun membre trouvé</h3><p>Ajoutez un nouveau membre pour commencer</p></div>';
            return;
        }

        container.innerHTML = filteredMembers.map(member => {
            const memberPayments = this.payments.filter(p => p.memberId === member.id);

            const lotPrice = this.getUnitPrice();
            const memberLotsTotal = (member.numberOfLots || 1) * lotPrice;

            const uniqueMonthsPaid = new Set(memberPayments.map(p => {
                if (p.monthKey) {
                    return p.monthKey;
                }
                const paymentDate = new Date(p.date);
                return `${paymentDate.getFullYear()}-${paymentDate.getMonth()}`;
            })).size;

            const progressPercentage = Math.round((uniqueMonthsPaid / member.paymentDuration) * 100);
            const isComplete = progressPercentage >= 100;

            // Vérifier si la date de fin approche
            let endDateWarning = '';
            if (member.endDate) {
                const endDate = new Date(member.endDate);
                const today = new Date();
                const daysRemaining = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
                
                if (daysRemaining < 0) {
                    endDateWarning = `<div style="background: #dc3545; color: white; padding: 8px; border-radius: 6px; margin-top: 8px; font-size: 0.85em;">Échéance dépassée de ${Math.abs(daysRemaining)} jours</div>`;
                } else if (daysRemaining <= 30) {
                    endDateWarning = `<div style="background: #ffc107; color: #000; padding: 8px; border-radius: 6px; margin-top: 8px; font-size: 0.85em;">Plus que ${daysRemaining} jours restants</div>`;
                }
            }

            const memberLotsNames = `${member.numberOfLots || 1} lot(s)`;

            const monthlyPayments = memberPayments.filter(p => {
                if (p.monthKey) {
                    const [year, month] = p.monthKey.split('-');
                    return parseInt(year) === this.currentYear && parseInt(month) === this.currentMonth;
                }
                const paymentDate = new Date(p.date);
                return paymentDate.getFullYear() === this.currentYear &&
                       paymentDate.getMonth() === this.currentMonth;
            });
            const hasPayedThisMonth = monthlyPayments.length > 0;

            return `
                <div class="member-card">
                    <div class="member-header">
                        <div style="display:flex;align-items:center;margin-right:10px;">
                            <input type="checkbox" class="member-select-checkbox" data-member-id="${member.id}" ${this.selectedMembers.has(String(member.id)) ? 'checked' : ''}>
                        </div>
                        <div class="member-info">
                            <div class="member-avatar">
                                ${member.name.charAt(0).toUpperCase()}
                            </div>
                            <div class="member-details">
                                <div class="member-name">${member.name}</div>
                                <div class="member-email">${member.email}</div>
                            </div>
                        </div>
                        <span class="status-badge ${hasPayedThisMonth ? 'paid' : 'pending'}">
                            ${hasPayedThisMonth ? 'Payé' : 'En Attente'}
                        </span>
                    </div>
                    <div class="member-stats">
                        <div class="member-stat">
                            <div class="member-stat-value">${this.formatCurrency(memberLotsTotal)}</div>
                            <div class="member-stat-label">Total des Lots</div>
                        </div>
                        <div class="member-stat">
                            <div class="member-stat-value">${member.paymentDuration} mois</div>
                            <div class="member-stat-label">Durée</div>
                        </div>
                    </div>
                    <div class="member-lots">
                        <div class="lots-label">Lots: ${memberLotsNames}</div>
                        <div class="payment-duration">Durée: ${member.paymentDuration || 12} mois</div>
                        ${member.startDate && member.endDate ? `
                            <div class="payment-dates" style="margin-top: 8px; font-size: 0.85em; color: #666;">
                                <div>Début: ${this.formatDate(member.startDate)}</div>
                                <div>Fin: ${this.formatDate(member.endDate)}</div>
                            </div>
                        ` : ''}
                        ${endDateWarning}
                    </div>
                    <div class="quota-progress">
                        <div class="quota-label">
                            <span>Progression</span>
                            <span class="quota-percentage">${uniqueMonthsPaid}/${member.paymentDuration} mois (${progressPercentage}%)</span>
                        </div>
                        <div class="quota-bar">
                            <div class="quota-fill ${isComplete ? 'complete' : ''}"
                                 style="width: ${Math.min(progressPercentage, 100)}%"></div>
                        </div>
                    </div>
<div class="member-actions">
    <button class="btn btn-small btn-primary member-add-payment" data-member-id="${member.id}">Ajouter Paiement</button>
<button class="btn btn-danger btn-small member-pdf-btn" data-member-id="${member.id}">
    <i class="fas fa-file-pdf"></i> Exporter PDF
</button>
    <button class="btn btn-small btn-danger member-delete" data-member-id="${member.id}">Supprimer</button>
</div>
                </div>
            `;
        }).join('');
        
        // Binder les boutons PDF (proprement) et synchroniser l'UI de sélection
        setTimeout(() => {
            document.querySelectorAll('.member-pdf-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const memberId = btn.dataset.memberId;
                    this.generateMemberDetailedReport(memberId);
                });
            });
            // After rendering, ensure checkboxes/rows reflect stored selection
            this.updateSelectionUI();
        }, 100);
        const bulkActions = document.getElementById('membersBulkActions');
        if (bulkActions) bulkActions.style.display = this.selectedMembers.size > 0 ? 'flex' : 'none';
        const selectAllGlobal = document.getElementById('selectAllMembersGlobal');
        if (selectAllGlobal) selectAllGlobal.checked = false;
        this.attachGlobalAscendingSortHandlers();
    }

    applyMemberSort(members) {
        if (!this.memberSort) return members;
        const dir = this.memberSort.dir === 'desc' ? -1 : 1;
        const key = this.memberSort.key;
        return members.sort((a, b) => {
            let va = '';
            let vb = '';
            if (key === 'name') { va = a.name || ''; vb = b.name || ''; }
            else if (key === 'lots') {
                const lotsA = a.lots ? a.lots.length : 0;
                const lotsB = b.lots ? b.lots.length : 0;
                return (lotsA - lotsB) * dir;
            }
            else if (key === 'amount') {
                const amtA = a.lots ? a.lots.reduce((sum, lotId) => {
                    const lot = this.lots.find(l => l.id === lotId);
                    return sum + (lot ? lot.price : 0);
                }, 0) : 0;
                const amtB = b.lots ? b.lots.reduce((sum, lotId) => {
                    const lot = this.lots.find(l => l.id === lotId);
                    return sum + (lot ? lot.price : 0);
                }, 0) : 0;
                return (amtA - amtB) * dir;
            }
            else if (key === 'totalPaid') {
                const payA = this.payments.filter(p => p.memberId === a.id).reduce((sum, p) => sum + p.amount, 0);
                const payB = this.payments.filter(p => p.memberId === b.id).reduce((sum, p) => sum + p.amount, 0);
                return (payA - payB) * dir;
            }
            else if (key === 'remaining') {
                const payA = this.payments.filter(p => p.memberId === a.id).reduce((sum, p) => sum + p.amount, 0);
                const payB = this.payments.filter(p => p.memberId === b.id).reduce((sum, p) => sum + p.amount, 0);
                const amtA = a.lots ? a.lots.reduce((sum, lotId) => {
                    const lot = this.lots.find(l => l.id === lotId);
                    return sum + (lot ? lot.price : 0);
                }, 0) : 0;
                const amtB = b.lots ? b.lots.reduce((sum, lotId) => {
                    const lot = this.lots.find(l => l.id === lotId);
                    return sum + (lot ? lot.price : 0);
                }, 0) : 0;
                const remA = Math.max(0, amtA - payA);
                const remB = Math.max(0, amtB - payB);
                return (remA - remB) * dir;
            }
            else if (key === 'status') {
                const payA = this.payments.filter(p => p.memberId === a.id).reduce((sum, p) => sum + p.amount, 0);
                const payB = this.payments.filter(p => p.memberId === b.id).reduce((sum, p) => sum + p.amount, 0);
                const amtA = a.lots ? a.lots.reduce((sum, lotId) => {
                    const lot = this.lots.find(l => l.id === lotId);
                    return sum + (lot ? lot.price : 0);
                }, 0) : 0;
                const amtB = b.lots ? b.lots.reduce((sum, lotId) => {
                    const lot = this.lots.find(l => l.id === lotId);
                    return sum + (lot ? lot.price : 0);
                }, 0) : 0;
                const statusA = payA >= amtA ? 'SOLDE' : 'NON-SOLDE';
                const statusB = payB >= amtB ? 'SOLDE' : 'NON-SOLDE';
                return statusA.localeCompare(statusB) * dir;
            }
            return va.localeCompare(vb) * dir;
        });
    }

    showProgressPopover(targetEl, member) {
        if (!member) return;
        const existing = document.querySelector('.progress-popover');
        if (existing) existing.remove();

        const memberPayments = this.payments.filter(p => p.memberId === member.id);
        const months = new Set(memberPayments.map(p => p.monthKey || `${new Date(p.date).getFullYear()}-${new Date(p.date).getMonth()}`));
        const paidCount = months.size;
        const total = member.paymentDuration || 0;
        const percent = total ? Math.round((paidCount / total) * 100) : 0;

        const pop = document.createElement('div');
        pop.className = 'progress-popover';
        pop.innerHTML = `
            <div class="popover-row"><strong>${member.name}</strong></div>
            <div class="popover-row">${paidCount} / ${total} mois (${percent}%)</div>
            <div class="popover-row">
                <button class="btn btn-primary btn-small popover-add" data-member-id="${member.id}">Ajouter paiement</button>
            </div>
        `;

        document.body.appendChild(pop);
        const rect = targetEl.getBoundingClientRect();
        pop.style.top = `${rect.top + window.scrollY + rect.height + 8}px`;
        pop.style.left = `${rect.left + window.scrollX}px`;

        const closePop = (e) => {
            if (!pop.contains(e.target)) {
                pop.remove();
                document.removeEventListener('click', closePop);
            }
        };
        setTimeout(() => document.addEventListener('click', closePop), 0);

        pop.querySelector('.popover-add').addEventListener('click', (e) => {
            e.stopPropagation();
            this.showAddPaymentModal(member.id);
            pop.remove();
            document.removeEventListener('click', closePop);
        });
    }

    applyLotSort(lots) {
        if (!this.lotSort) return lots;
        const dir = this.lotSort.dir === 'desc' ? -1 : 1;
        const key = this.lotSort.key;
        return lots.sort((a, b) => {
            if (key === 'price') return ((a.price || 0) - (b.price || 0)) * dir;
            if (key === 'members') {
                const ma = this.members.filter(m => m.lots && m.lots.includes(a.id)).length;
                const mb = this.members.filter(m => m.lots && m.lots.includes(b.id)).length;
                return (ma - mb) * dir;
            }
            let va = '';
            let vb = '';
            if (key === 'location') { va = a.location || ''; vb = b.location || ''; }
            else { va = a.name || ''; vb = b.name || ''; }
            return va.localeCompare(vb) * dir;
        });
    }

    // Fonction pour changer la photo principale du lot
    changeLotPhoto(photoId, index) {
        const mainPhoto = document.getElementById('lotPhotoMain');
        const lot = this.lots.find(l => l.photos && l.photos.find(p => p.id === photoId));
        
        if (lot && mainPhoto) {
            const photo = lot.photos[index];
            mainPhoto.src = photo.data;
            
            // Mettre à jour les vignettes actives
            document.querySelectorAll('.lot-photo-thumb').forEach((thumb, i) => {
                thumb.classList.toggle('active', i === index);
            });
        }
    }

    // Générer un rapport détaillé pour un membre
    // Calculer statut conformité membre
    getMemberComplianceStatus(member, totalPaid, expectedTotal) {
        if (expectedTotal === 0) return { status: 'complété', color: '#27AE60', label: 'Complété' };
        const progress = (totalPaid / expectedTotal) * 100;
        if (progress >= 100) return { status: 'complété', color: '#27AE60', label: 'Complété' };
        if (progress >= 80) return { status: 'en-règle', color: '#3498DB', label: 'En règle' };
        if (progress >= 50) return { status: 'partiel', color: '#F39C12', label: 'Partiel' };
        return { status: 'risque', color: '#E74C3C', label: 'À risque' };
    }

    // Générer frise temporelle paiements par mois
    generatePaymentTimeline(member, memberPayments) {
        const duration = member.duration || 12;
        const startDate = member.startDate ? new Date(member.startDate) : new Date(member.createdAt);
        const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
        
        let timeline = [];
        for (let i = 0; i < duration; i++) {
            const monthDate = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
            const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
            const payment = memberPayments.find(p => p.monthKey === monthKey || 
                (p.month === monthNames[monthDate.getMonth()] && new Date(p.date).getFullYear() === monthDate.getFullYear()));
            
            timeline.push({
                month: monthNames[monthDate.getMonth()],
                year: monthDate.getFullYear(),
                monthFull: new Date(monthDate.getFullYear(), monthDate.getMonth()).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
                paid: !!payment,
                amount: payment ? payment.amount : 0,
                monthKey: monthKey
            });
        }
        return timeline;
    }

    // Calculer date fin estimée
    calculateEstimatedEndDate(member, memberPayments) {
        if (memberPayments.length === 0) return null;
        const startDate = member.startDate ? new Date(member.startDate) : new Date(member.createdAt);
        const duration = member.duration || 12;
        const expectedEndDate = new Date(startDate.getFullYear(), startDate.getMonth() + duration, 0);
        
        // Si paiements réguliers, estimer basé sur le rythme
        const paymentDates = memberPayments.sort((a, b) => new Date(a.date) - new Date(b.date)).map(p => new Date(p.date));
        if (paymentDates.length >= 2) {
            const intervals = [];
            for (let i = 1; i < paymentDates.length; i++) {
                intervals.push((paymentDates[i] - paymentDates[i-1]) / (1000 * 60 * 60 * 24));
            }
            const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
            const remainingPayments = duration - memberPayments.length;
            const estimatedDate = new Date(paymentDates[paymentDates.length - 1].getTime() + avgInterval * remainingPayments * 1000 * 60 * 60 * 24);
            return estimatedDate;
        }
        return expectedEndDate;
    }

    // Cohérence paiements (mois consécutifs)
    calculatePaymentConsistency(timeline) {
        let maxConsecutive = 0;
        let currentConsecutive = 0;
        let missedConsecutive = 0;
        let maxMissed = 0;
        
        for (let item of timeline) {
            if (item.paid) {
                currentConsecutive++;
                maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
                missedConsecutive = 0;
            } else {
                missedConsecutive++;
                maxMissed = Math.max(maxMissed, missedConsecutive);
                currentConsecutive = 0;
            }
        }
        return { maxConsecutive, maxMissed };
    }

    generateMemberDetailedReport(memberId) {
        const member = this.members.find(m => m.id === memberId);
        if (!member) return;
        
        const memberPayments = this.payments.filter(p => p.memberId === memberId);
        const totalPaid = memberPayments.reduce((sum, p) => sum + p.amount, 0);
        
        // Calculer le taux de ponctualité - utiliser paymentDuration
        const durationMonths = member.paymentDuration || member.duration || 12;
        const expectedPayments = Math.min(
            durationMonths,
            this.getMonthsSinceCreation(member.createdAt)
        );
        const actualPayments = memberPayments.length;
        const punctualityRate = expectedPayments > 0 
            ? Math.round((actualPayments / expectedPayments) * 100) 
            : 0;
        
        // Nouvelles données
        const timeline = this.generatePaymentTimeline(member, memberPayments);
        const expectedTotal = (member.monthlyQuota || 0) * durationMonths;
        const complianceStatus = this.getMemberComplianceStatus(member, totalPaid, expectedTotal);
        const estimatedEndDate = this.calculateEstimatedEndDate(member, memberPayments);
        const consistency = this.calculatePaymentConsistency(timeline);
        
        // Lots du membre
        const numberOfLots = member.numberOfLots || 0;
        const lotPrice = this.getUnitPrice();
        const totalLotsValue = numberOfLots * lotPrice;
        
        const reportHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; padding: 30px;">
                <!-- En-tête -->
                <div style="text-align: center; margin-bottom: 30px; border-bottom: 3px solid #2C3E50; padding-bottom: 20px;">
                    <h1 style="color: #2C3E50; margin: 0; font-size: 28px;">CI Habitat</h1>
                    <p style="color: #7F8C8D; margin: 10px 0 0 0; font-size: 16px;">Fiche Détaillée Membre</p>
                </div>
                
                <!-- Informations du membre -->
                <div style="background: #2C3E50; color: white; padding: 25px; border-radius: 12px; margin-bottom: 25px;">
                    <h2 style="margin: 0 0 15px 0; font-size: 24px;">${member.name}</h2>
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">
                        <div>
                            <p style="margin: 5px 0; opacity: 0.9;"><strong><i class="fas fa-envelope" style="margin-right: 5px;"></i>Email:</strong> ${member.email || 'N/A'}</p>
                            <p style="margin: 5px 0; opacity: 0.9;"><strong><i class="fas fa-phone" style="margin-right: 5px;"></i>Téléphone:</strong> ${member.phone || 'N/A'}</p>
                        </div>
                        <div>
                            <p style="margin: 5px 0; opacity: 0.9;"><strong><i class="fas fa-calendar-plus" style="margin-right: 5px;"></i>Inscription:</strong> ${new Date(member.createdAt).toLocaleDateString('fr-FR')}</p>
                            <p style="margin: 5px 0; opacity: 0.9;"><strong><i class="fas fa-clock" style="margin-right: 5px;"></i>Durée de cotisation:</strong> ${member.paymentDuration || 12} mois</p>
                        </div>
                    </div>
                    ${member.startDate && member.endDate ? `
                        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.3);">
                            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">
                                <div>
                                    <p style="margin: 5px 0; opacity: 0.9;"><strong><i class="fas fa-play-circle" style="margin-right: 5px;"></i>Début Cotisation:</strong> ${new Date(member.startDate).toLocaleDateString('fr-FR')}</p>
                                </div>
                                <div>
                                    <p style="margin: 5px 0; opacity: 0.9;"><strong><i class="fas fa-flag-checkered" style="margin-right: 5px;"></i>Fin Cotisation:</strong> ${new Date(member.endDate).toLocaleDateString('fr-FR')}</p>
                                </div>
                            </div>
                        </div>
                    ` : ''}
                </div>
                
                <!-- Statistiques -->
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 25px;">
                    <div style="background: #F0F9FF; padding: 20px; border-radius: 10px; text-align: center; border-left: 4px solid #3498DB;">
                        <div style="font-size: 24px; font-weight: bold; color: #3498DB;">${this.formatCurrency(totalPaid)}</div>
                        <div style="color: #5D6D7E; font-size: 13px; margin-top: 5px;">Total Payé</div>
                    </div>
                    <div style="background: #F0FFF4; padding: 20px; border-radius: 10px; text-align: center; border-left: 4px solid #27AE60;">
                        <div style="font-size: 24px; font-weight: bold; color: #27AE60;">${actualPayments}</div>
                        <div style="color: #5D6D7E; font-size: 13px; margin-top: 5px;">Paiements Effectués</div>
                    </div>
                </div>
                
                <!-- Lots attribués -->
                ${numberOfLots > 0 ? `
                    <div style="margin-bottom: 25px;">
                        <h3 style="color: #2C3E50; border-bottom: 2px solid #2C3E50; padding-bottom: 10px; margin-bottom: 15px;">
                            <i class="fas fa-home" style="margin-right: 8px;"></i>Lots Attribués
                        </h3>
                        <div style="background: #F8F9FA; padding: 15px; border-radius: 8px; border-left: 3px solid #3498DB;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <div style="font-weight: bold; color: #2C3E50; font-size: 16px;">${numberOfLots} lot(s) attribué(s)</div>
                                </div>
                                <div style="font-weight: bold; color: #27AE60; font-size: 18px;">${this.formatCurrency(totalLotsValue)}</div>
                            </div>
                        </div>
                        <div style="margin-top: 15px; padding: 15px; background: #27AE60; color: white; border-radius: 8px; text-align: center;">
                            <div style="font-size: 14px; opacity: 0.9;">Valeur Totale des Lots</div>
                            <div style="font-size: 26px; font-weight: bold; margin-top: 5px;">${this.formatCurrency(totalLotsValue)}</div>
                        </div>
                    </div>
                ` : ''}

                <!-- Conditions Contractuelles -->
                <div style="margin-bottom: 25px;">
                    <h3 style="color: #2C3E50; border-bottom: 2px solid #2C3E50; padding-bottom: 10px; margin-bottom: 15px;">
                        <i class="fas fa-file-contract" style="margin-right: 8px;"></i>Conditions Contractuelles
                    </h3>
                    <table style="width: 100%; border-collapse: collapse; background: white;">
                        <tbody>
                            <tr style="border-bottom: 1px solid #E0E6ED;">
                                <td style="padding: 12px; font-weight: 600; color: #2C3E50; width: 40%;">Quota Mensuel</td>
                                <td style="padding: 12px; color: #3498DB; font-weight: bold;">${this.formatCurrency(member.monthlyQuota || 0)}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #E0E6ED; background: #F8F9FA;">
                                <td style="padding: 12px; font-weight: 600; color: #2C3E50;">Durée Engagement</td>
                                <td style="padding: 12px; color: #3498DB; font-weight: bold;">${durationMonths} mois</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #E0E6ED;">
                                <td style="padding: 12px; font-weight: 600; color: #2C3E50;">Montant Attendu</td>
                                <td style="padding: 12px; color: #3498DB; font-weight: bold;">${this.formatCurrency(expectedTotal)}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #E0E6ED; background: #F8F9FA;">
                                <td style="padding: 12px; font-weight: 600; color: #2C3E50;">Montant Collecté</td>
                                <td style="padding: 12px; color: #27AE60; font-weight: bold;">${this.formatCurrency(totalPaid)}</td>
                            </tr>
                            <tr style="background: ${expectedTotal > 0 ? (totalPaid >= expectedTotal ? '#E8F8F5' : totalPaid >= expectedTotal * 0.8 ? '#FEF9E7' : '#FADBD8') : '#E8F8F5'};">
                                <td style="padding: 12px; font-weight: 600; color: #2C3E50;">Restant à Collecter</td>
                                <td style="padding: 12px; color: ${expectedTotal > 0 ? (totalPaid >= expectedTotal ? '#27AE60' : totalPaid >= expectedTotal * 0.8 ? '#F39C12' : '#E74C3C') : '#27AE60'}; font-weight: bold;">${this.formatCurrency(Math.max(0, expectedTotal - totalPaid))}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                
                <!-- Historique des paiements -->
                <div style="margin-bottom: 25px;">
                    <h3 style="color: #2C3E50; border-bottom: 2px solid #2C3E50; padding-bottom: 10px; margin-bottom: 15px;">
                        <i class="fas fa-credit-card" style="margin-right: 8px;"></i>Historique des Paiements
                    </h3>
                    ${memberPayments.length > 0 ? `
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr style="background: #F8F9FA;">
                                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #E0E6ED; color: #2C3E50;">Date</th>
                                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #E0E6ED; color: #2C3E50;">Montant</th>
                                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #E0E6ED; color: #2C3E50;">Période</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${memberPayments.sort((a, b) => new Date(b.date) - new Date(a.date)).map((payment, index) => {
                                    const monthKey = payment.monthKey || (() => {
                                        const d = new Date(payment.date);
                                        return `${d.getFullYear()}-${d.getMonth()}`;
                                    })();
                                    const [year, month] = monthKey.split('-');
                                    const monthNames = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
                                    const monthDisplay = monthNames[parseInt(month, 10)] + ' ' + year;
                                    return `
                                    <tr style="border-bottom: 1px solid #E0E6ED; ${index % 2 === 0 ? 'background: #FAFBFC;' : ''}">
                                        <td style="padding: 10px;">${new Date(payment.date).toLocaleDateString('fr-FR')}</td>
                                        <td style="padding: 10px; color: #27AE60; font-weight: bold;">${this.formatCurrency(payment.amount)}</td>
                                        <td style="padding: 10px;">${monthDisplay}</td>
                                    </tr>
                                `}).join('')}
                            </tbody>
                        </table>
                    ` : '<p style="text-align: center; color: #5D6D7E; padding: 20px;">Aucun paiement enregistré</p>'}
                </div>
                
                <!-- Restant à payer -->
                <div style="background: ${expectedTotal > 0 ? (totalPaid >= expectedTotal ? '#E8F8F5' : totalPaid >= expectedTotal * 0.8 ? '#FEF9E7' : '#FADBD8') : '#E8F9FA'}; padding: 20px; border-radius: 10px; margin-bottom: 25px; border-left: 4px solid ${expectedTotal > 0 ? (totalPaid >= expectedTotal ? '#27AE60' : totalPaid >= expectedTotal * 0.8 ? '#F39C12' : '#E74C3C') : '#3498DB'};">
                    <h4 style="color: #2C3E50; margin: 0 0 15px 0;"><i class="fas fa-wallet" style="margin-right: 8px;"></i>Restant à Payer</h4>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-size: 14px; color: #5D6D7E; margin-bottom: 5px;">Montant Restant</div>
                            <div style="font-size: 28px; font-weight: bold; color: ${expectedTotal > 0 ? (totalPaid >= expectedTotal ? '#27AE60' : totalPaid >= expectedTotal * 0.8 ? '#F39C12' : '#E74C3C') : '#3498DB'};">
                                ${this.formatCurrency(Math.max(0, expectedTotal - totalPaid))}
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 14px; color: #5D6D7E; margin-bottom: 5px;">Taux de Paiement</div>
                            <div style="font-size: 24px; font-weight: bold; color: #2C3E50;">
                                ${expectedTotal > 0 ? Math.round((totalPaid / expectedTotal) * 100) : 0}%
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Pied de page -->
                <div style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #E0E6ED; text-align: center; color: #5D6D7E; font-size: 12px;">
                    <p style="margin: 5px 0;"><i class="fas fa-phone-alt" style="margin-right: 5px;"></i>Contact: 01 618 837 90</p>
                    <p style="margin: 5px 0;">Document généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}</p>
                    <p style="margin: 15px 0 0 0; font-weight: bold; color: #181818;">CI Habitat - L'immobilier Autrement</p>
                </div>
            </div>
        `;
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = reportHtml;
        tempDiv.style.position = 'absolute';
        tempDiv.style.left = '-9999px';
        document.body.appendChild(tempDiv);
        
        html2canvas(tempDiv.firstElementChild, {
            scale: 2,
            backgroundColor: '#ffffff',
            logging: false
        }).then(canvas => {
            document.body.removeChild(tempDiv);
            
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const imgData = canvas.toDataURL('image/png');
            const imgWidth = 190;
            const pageHeight = 277;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;
            let heightLeft = imgHeight;
            let position = 10;
            
            pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;
            
            while (heightLeft >= 0) {
                position = heightLeft - imgHeight + 10;
                pdf.addPage();
                pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;
            }
            
            const fileName = `Rapport_${member.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
            pdf.save(fileName);
            
            this.showNotification('Rapport PDF généré avec succès !', 'success');
        }).catch(error => {
            console.error('Erreur génération PDF:', error);
            this.showNotification('Erreur lors de la génération du PDF', 'error');
        });
    }

    // Calculer le nombre de mois depuis la création
    getMonthsSinceCreation(createdAt) {
        const created = new Date(createdAt);
        const now = new Date();
        return (now.getFullYear() - created.getFullYear()) * 12 + 
               (now.getMonth() - created.getMonth()) + 1;
    }

getSvgIcon(name, size = 20) {
    const s = Number(size);
    const common = `width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"`;
    switch (name) {
        case 'building':
            return `<svg ${common}><rect x="3" y="4" width="18" height="16" rx="2" stroke="#2C3E50" stroke-width="1.2" fill="#F8F9FA"/><rect x="7" y="8" width="2" height="2" fill="#2C3E50"/><rect x="11" y="8" width="2" height="2" fill="#2C3E50"/><rect x="15" y="8" width="2" height="2" fill="#2C3E50"/></svg>`;
        case 'wallet':
            return `<svg ${common}><rect x="2" y="6" width="20" height="12" rx="2" stroke="#27AE60" stroke-width="1.2" fill="#fff"/><circle cx="18" cy="12" r="1.6" fill="#27AE60"/></svg>`;
        case 'bullseye':
            return `<svg ${common}><circle cx="12" cy="12" r="9" stroke="#181818" stroke-width="1.2" fill="none"/><circle cx="12" cy="12" r="5" stroke="#181818" stroke-width="1.2" fill="none"/></svg>`;
        case 'percentage':
            return `<svg ${common}><path d="M4 4L20 20" stroke="#F39C12" stroke-width="1.6"/><circle cx="7.5" cy="7.5" r="1.8" fill="#F39C12"/><circle cx="16.5" cy="16.5" r="1.8" fill="#F39C12"/></svg>`;
        case 'home':
            return `<svg ${common}><path d="M3 11L12 4L21 11" stroke="#181818" stroke-width="1.2" fill="none"/><rect x="6" y="11" width="12" height="8" rx="1" stroke="#181818" stroke-width="1.2" fill="#fff"/></svg>`;
        case 'table':
            return `<svg ${common}><rect x="3" y="4" width="18" height="16" rx="1" stroke="#2C3E50" stroke-width="1.2" fill="#fff"/><path d="M3 10h18M10 4v16" stroke="#2C3E50" stroke-width="1"/></svg>`;
        case 'chart-bar':
            return `<svg ${common}><rect x="4" y="10" width="3" height="10" rx="0.5" fill="#27AE60"/><rect x="10.5" y="6" width="3" height="14" rx="0.5" fill="#181818"/><rect x="17" y="3" width="3" height="17" rx="0.5" fill="#F39C12"/></svg>`;
        case 'users':
            return `<svg ${common}><circle cx="9" cy="8" r="2.2" fill="#2C3E50"/><path d="M4 18c1.5-4 7-4 8 0" stroke="#2C3E50" stroke-width="1.2" fill="none"/><circle cx="17" cy="8" r="1.8" fill="#5D6D7E"/></svg>`;
        default:
            return `<svg ${common}><circle cx="12" cy="12" r="10" stroke="#2C3E50" stroke-width="1.2" fill="#fff"/></svg>`;
    }
}

formatCurrencyForPDF(amount) {
    if (typeof this.formatCurrency === 'function') return this.formatCurrency(amount);
    try {
        return new Intl.NumberFormat('fr-FR').format(Number(amount || 0)) + ' FCFA';
    } catch (e) {
        return (amount || 0) + ' FCFA';
    }
}

async exportMemberToPDF(memberId) {
    try {
        const member = this.members.find(m => m.id === memberId);
        if (!member) { this.showNotification('Membre introuvable', 'error'); return; }

        const memberPayments = this.payments.filter(p => p.memberId === member.id);
        const totalPaid = memberPayments.reduce((s,p) => s + p.amount, 0);
        const durationMonths = member.paymentDuration || member.duration || 0;
        const expectedTotal = (member.monthlyQuota || 0) * durationMonths;
        const progress = expectedTotal > 0 ? (totalPaid / expectedTotal) * 100 : 0;
        const remaining = Math.max(0, expectedTotal - totalPaid);

        let lotName = 'Aucun lot';
        if ((member.numberOfLots || 0) > 0) {
            lotName = `${member.numberOfLots} lot(s)`;
        }

        const reportContainer = document.createElement('div');
        reportContainer.className = 'pdf-report-container';
        reportContainer.id = 'pdf-report-member';

        const now = new Date();
        reportContainer.innerHTML = `
            <div class="pdf-header">
                <div class="pdf-logo-section">
                        <img src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QCMRXhpZgAATU0AKgAAAAgABQESAAMAAAABAAEAAAEaAAUAAAABAAAASgEbAAUAAAABAAAAUgEoAAMAAAABAAIAAIdpAAQAAAABAAAAWgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAA8CgAwAEAAAAAQAAA8AAAAAA/8AAEQgDwAPAAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAwMDAwMDBAMDBAYEBAQGCAYGBgYICggICAgICg0KCgoKCgoNDQ0NDQ0NDQ8PDw8PDxISEhISFBQUFBQUFBQUFP/bAEMBAwMDBQUFCQUFCRUODA4VFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFf/dAAQAPP/aAAwDAQACEQMRAD8A/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/0P1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//R/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/0v1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9P9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//1P1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9X9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/W/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9f9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/Q/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/0f1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//S/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/0/1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9T9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//1f1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9b9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/X/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9D9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/R/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADK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AoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9H9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/S/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9P9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/U/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/1f1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//W/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/1/1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9D9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//0f1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9L9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/T/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9T9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/V/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/1v1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//X/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/0P1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9H9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//0v1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9k=" style="height:40px;width:40px;border-radius:50%;" />
                    <div class="pdf-company-info">
                        <h1>CI Habitat IMMOBILER</h1>
                        <p>Fiche Membre • ${member.name}</p>
                    </div>
                </div>
                <div class="pdf-report-meta">
                    <h2>FICHE MEMBRE</h2>
                    <p>Généré le ${now.toLocaleDateString('fr-FR')} • ${now.toLocaleTimeString('fr-FR')}</p>
                    <p>Id : ${member.id}</p>
                </div>
            </div>

            <div class="pdf-metrics-grid">
                <div class="pdf-metric-card metric-collected">
                    <div class="pdf-metric-icon">${this.getSvgIcon('wallet',24)}</div>
                    <div class="pdf-metric-value">${this.formatCurrencyForPDF(totalPaid)}</div>
                    <div class="pdf-metric-label">Total Payé</div>
                </div>
                <div class="pdf-metric-card metric-expected">
                    <div class="pdf-metric-icon">${this.getSvgIcon('bullseye',24)}</div>
                    <div class="pdf-metric-value">${this.formatCurrencyForPDF(expectedTotal)}</div>
                    <div class="pdf-metric-label">Objectif</div>
                </div>
                <div class="pdf-metric-card metric-progress">
                    <div class="pdf-metric-icon">${this.getSvgIcon('percentage',24)}</div>
                    <div class="pdf-metric-value">${Math.round(progress)}%</div>
                    <div class="pdf-metric-label">Progression</div>
                </div>
                <div class="pdf-metric-card metric-lot">
                    <div class="pdf-metric-icon">${this.getSvgIcon('home',24)}</div>
                    <div class="pdf-metric-value">${lotName}</div>
                    <div class="pdf-metric-label">Lot sélectionné</div>
                </div>
            </div>

            <div class="pdf-progress-container">
                <div class="pdf-progress-header"><span>Progression</span><span style="font-weight:600">${Math.round(progress)}%</span></div>
                <div class="pdf-progress-bar"><div class="pdf-progress-fill" style="width:${Math.min(progress,100)}%"></div></div>
            </div>

            <div class="pdf-section">
                <h3 class="pdf-section-title">${this.getSvgIcon('table',18)} Historique des paiements</h3>
                <table class="pdf-table">
                    <thead>
                        <tr><th>Date</th><th>Montant</th><th>Statut</th></tr>
                    </thead>
                    <tbody>
                        ${memberPayments.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(p => `
                            <tr>
                                <td>${new Date(p.date).toLocaleDateString('fr-FR')}</td>
                                <td>${this.formatCurrencyForPDF(p.amount)}</td>
                                <td style="color:#27AE60;font-weight:600">Payé</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <div class="pdf-section">
                <h3 class="pdf-section-title">Informations personnelles</h3>
                <table class="pdf-table">
                    <tbody>
                        <tr><td>Nom complet</td><td>${member.name}</td></tr>
                        <tr><td>Email</td><td>${member.email || '—'}</td></tr>
                        <tr><td>Téléphone</td><td>${member.phone || '—'}</td></tr>
                        <tr><td>Quota mensuel</td><td>${this.formatCurrencyForPDF(member.monthlyQuota || 0)}</td></tr>
                        <tr><td>Durée engagement</td><td>${durationMonths} mois</td></tr>
                    </tbody>
                </table>
            </div>

                          <!-- Pied de page -->
                <div class="pdf-footer">
                    <p><strong>CI Habitat</strong> - L'immobilier Autrement</p>
                    <p>Rapport généré  le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}</p>
                    <p>Pour plus d'informations, contactez le ☎️ 01 618 837 90.</p>
                </div>
        `;

        document.body.appendChild(reportContainer);
        await new Promise(r => setTimeout(r, 350));
        const canvas = await html2canvas(reportContainer, { scale:2, useCORS:true, backgroundColor:'#ffffff' });
        document.body.removeChild(reportContainer);

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p','mm','a4');
        const img = canvas.toDataURL('image/png');
        const imgWidth = 210; const pageHeight = 295; const imgHeight = (canvas.height * imgWidth) / canvas.width;
        let heightLeft = imgHeight; let position = 0;
        pdf.addImage(img,'PNG',0,position,imgWidth,imgHeight);
        heightLeft -= pageHeight;
        while (heightLeft >= 0) { position = heightLeft - imgHeight; pdf.addPage(); pdf.addImage(img,'PNG',0,position,imgWidth,imgHeight); heightLeft -= pageHeight; }
        pdf.save(`Fiche_Membre_${member.name.replace(/[^a-zA-Z0-9]/g,'_')}_${new Date().toISOString().slice(0,10)}.pdf`);
        this.showNotification('Fiche membre générée', 'success');

    } catch (err) {
        console.error(err);
        this.showNotification('Erreur génération fiche membre', 'error');
    }
}

    renderPayments() {
        const container = document.getElementById('paymentsList');
        const searchTerm = document.getElementById('paymentSearch').value.toLowerCase();
        const monthFilter = document.getElementById('monthFilter').value;
        const memberFilter = document.getElementById('memberFilter').value;

        let filteredPayments = this.payments;

        if (searchTerm) {
            filteredPayments = filteredPayments.filter(payment => {
                const member = this.members.find(m => m.id === payment.memberId);
                return member && member.name.toLowerCase().includes(searchTerm);
            });
        }

        if (monthFilter) {
            filteredPayments = filteredPayments.filter(payment => {
                if (payment.monthKey) {
                    return payment.monthKey === monthFilter;
                }
                const paymentDate = new Date(payment.date);
                return paymentDate.getMonth() === parseInt(monthFilter) &&
                       paymentDate.getFullYear() === this.currentYear;
            });
        }

        // Start/End month range filtering (inputs type=month: YYYY-MM)
        const startMonthVal = (document.getElementById('paymentStartMonth') || {}).value;
        const endMonthVal = (document.getElementById('paymentEndMonth') || {}).value;
        if (startMonthVal || endMonthVal) {
            let startDate = startMonthVal ? new Date(startMonthVal + '-01') : new Date('1970-01-01');
            let endDate = endMonthVal ? new Date(endMonthVal + '-01') : new Date('2999-12-31');
            // set endDate to last day of month
            endDate = new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0, 23,59,59,999);
            filteredPayments = filteredPayments.filter(payment => {
                const pd = new Date(payment.date);
                return pd >= startDate && pd <= endDate;
            });
        }

        if (memberFilter) {
            filteredPayments = filteredPayments.filter(payment =>
                payment.memberId === memberFilter
            );
        }
        filteredPayments.sort((a, b) => new Date(b.date) - new Date(a.date));

        if (filteredPayments.length === 0) {
            container.innerHTML = '<div class="empty-state"><h3>Aucun paiement trouvé</h3><p>Aucun paiement ne correspond à vos filtres</p></div>';
            return;
        }

        container.innerHTML = filteredPayments.map(payment => {
            const member = this.members.find(m => m.id === payment.memberId);
            const paymentDate = new Date(payment.date);

            const monthNames = [
                'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
                'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
            ];
            let monthPaid = 'Non spécifié';
            if (payment.monthKey) {
                const [year, month] = payment.monthKey.split('-');
                monthPaid = `${monthNames[parseInt(month)]} ${year}`;
            }

            return `
                <div class="payment-card">
                    <div class="payment-header">
                        <div class="payment-member">${member ? member.name : 'Membre Inconnu'}</div>
                        <div class="payment-amount">${this.formatCurrency(payment.amount)}</div>
                    </div>
                    <div class="payment-details">
                        <div class="payment-date">${this.formatDate(payment.date)}</div>
                        <div class="payment-month">Mois: ${monthPaid}</div>
                    </div>
                    <div class="payment-actions">
                        <button class="btn btn-sm btn-secondary" onclick="app.printReceipt('${payment.id}')">
                            Reçu
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        this.attachGlobalAscendingSortHandlers();
    }

showLotDetails(lotId) {
    const lot = this.lots.find(l => l.id === lotId);
    if (!lot) return;

    console.log('Lot sélectionné:', lot);
    console.log('Tous les membres:', this.members);
    console.log('ID du lot recherché:', lotId);

    const membersWithLot = this.members.filter(member => {
        return (member.numberOfLots || 0) > 0;
    });

    console.log('Membres trouvés pour ce lot:', membersWithLot);

    // Galerie de photos
    let photosHtml = '';
    if (lot.photos && lot.photos.length > 0) {
        photosHtml = `
            <div class="lot-photos-gallery">
                <div class="lot-photos-carousel">
                    <img src="${lot.photos[0].data}" alt="${lot.name}" class="lot-photo-main" id="lotPhotoMain">
                </div>
                ${lot.photos.length > 1 ? `
                    <div class="lot-photos-thumbnails">
                        ${lot.photos.map((photo, index) => `
                            <img src="${photo.data}" 
                                 alt="${lot.name} ${index + 1}" 
                                 class="lot-photo-thumb ${index === 0 ? 'active' : ''}" 
                                 onclick="window.paymentManager.changeLotPhoto('${photo.id}', ${index})">
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    const lotTabInfo = document.getElementById('lotTabInfo');
    lotTabInfo.innerHTML = `
        ${photosHtml}
        <div class="lot-details-grid">
            <div class="lot-detail-item">
                <div class="lot-detail-label">Nom du Lot</div>
                <div class="lot-detail-value">${lot.name}</div>
            </div>
            <div class="lot-detail-item">
                <div class="lot-detail-label">Prix</div>
                <div class="lot-detail-value">${this.formatCurrency(lot.price)}</div>
            </div>
            <div class="lot-detail-item">
                <div class="lot-detail-label">Localisation</div>
                <div class="lot-detail-value">${lot.location || '-'}</div>
            </div>
            <div class="lot-detail-item">
                <div class="lot-detail-label">Statut</div>
                <div class="lot-detail-value">
                    <span class="status-badge ${lot.available ? 'available' : 'unavailable'}">
                        ${lot.available ? 'Disponible' : 'Non disponible'}
                    </span>
                </div>
            </div>
            <div class="lot-detail-item full-width">
                <div class="lot-detail-label">Description</div>
                <div class="lot-detail-value">${lot.description || '-'}</div>
            </div>
            <div class="lot-detail-item">
                <div class="lot-detail-label">Date de Création</div>
                <div class="lot-detail-value">${this.formatDate(lot.createdAt)}</div>
            </div>
            <div class="lot-detail-item">
                <div class="lot-detail-label">Membres Inscrits</div>
                <div class="lot-detail-value">
                    <span class="members-count">${membersWithLot.length} membre(s)</span>
                </div>
            </div>
        </div>
    `;

    document.getElementById('lotMembersCount').textContent = membersWithLot.length;

    this.renderLotMembersNew(membersWithLot, lot);

    const _lotDetailsModal = document.getElementById('lotDetailsModal');
    if (_lotDetailsModal) {
        try { window._lastScrollY = window.scrollY || window.pageYOffset || 0; } catch (e) {}
        _lotDetailsModal.classList.add('active');
        try { document.body.classList.add('modal-open'); } catch (e) {}
    }
}

closeLotDetailsModal() {
    document.getElementById('lotDetailsModal').classList.remove('active');
}

populateLotMembers(members) {
    const container = document.getElementById('lotMembersList');

    if (members.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Aucun membre inscrit à ce lot</p></div>';
        return;
    }

    container.innerHTML = members.map(member => {
        const memberPayments = this.payments.filter(p => p.memberId === member.id);
        const totalPaid = memberPayments.reduce((sum, p) => sum + p.amount, 0);
        const lastPayment = memberPayments.length > 0 ?
            memberPayments.sort((a, b) => new Date(b.date) - new Date(a.date))[0] : null;

        return `
            <div class="lot-member-item">
                <div class="lot-member-avatar">${member.name.charAt(0).toUpperCase()}</div>
                <div class="lot-member-info">
                    <div class="lot-member-name">${member.name}</div>
                    <div class="lot-member-phone">${member.phone}</div>
                    <div class="lot-member-stats">
                        <span class="lot-member-stat">Total payé: ${this.formatCurrency(totalPaid)}</span>
                        ${lastPayment ? `<span class="lot-member-stat">Dernier paiement: ${this.formatDate(lastPayment.date)}</span>` : '<span class="lot-member-stat">Aucun paiement</span>'}
                    </div>
                </div>
                <div class="lot-member-status ${memberPayments.length > 0 ? 'paid' : 'pending'}">
                    <i class="fas ${memberPayments.length > 0 ? 'fa-check-circle' : 'fa-clock'}"></i>
                </div>
            </div>
        `;
    }).join('');
}

closeLotDetailsModal() {
    const _lotDetailsModal = document.getElementById('lotDetailsModal');
    if (_lotDetailsModal) {
        _lotDetailsModal.classList.remove('active');
        try { document.body.classList.remove('modal-open'); } catch (e) {}
        try { const y = window._lastScrollY || 0; window.scrollTo({ top: y, behavior: 'smooth' }); window._lastScrollY = null; } catch (e) {}
    }

    document.querySelectorAll('.modal-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.lot-tab-content').forEach(content => content.classList.remove('active'));
    document.querySelector('.modal-tab[data-lot-tab="info"]').classList.add('active');
    document.getElementById('lotTabInfo').classList.add('active');
}
    renderLotsListView(filteredLots) {
        const container = document.getElementById('lotsGrid');
        if (!this.selectedLots) {
            const stored = localStorage.getItem('selectedLots');
            this.selectedLots = stored ? new Set(JSON.parse(stored).map(String)) : new Set();
        }
        if (!this.lotSort) {
            const savedKey = localStorage.getItem('lotSortKey') || 'name';
            const savedDir = localStorage.getItem('lotSortDir') || 'asc';
            this.lotSort = { key: savedKey, dir: savedDir };
        }
        if (filteredLots.length === 0) {
            container.innerHTML = '<div class="empty-state"><h3>Aucun lot trouvé</h3><p>Ajoutez un nouveau lot pour commencer</p></div>';
            return;
        }

        const sortedLots = this.applyLotSort([...filteredLots]);
        const allVisibleSelected = sortedLots.every(l => this.selectedLots.has(l.id));

        let html = `
            <div class="table-container">
                ${this.selectedLots.size > 0 ? `
                    <div class="bulk-bar">
                        <div class="bulk-info">${this.selectedLots.size} sélectionné(s)</div>
                        <div class="bulk-actions">
                            <button class="btn btn-secondary btn-small" id="bulkExportLots">Exporter PDF</button>
                            <button class="btn btn-danger btn-small" id="bulkDeleteLots">Supprimer</button>
                        </div>
                    </div>
                ` : ''}
                <table class="lots-table">
                    <thead>
                        <tr>
                            <th class="cell-select"><input type="checkbox" id="selectAllLots" ${allVisibleSelected ? 'checked' : ''}></th>
                            <th data-sort="name" class="sortable">Nom du Lot <span class="sort-indicator">${this.lotSort.key === 'name' ? (this.lotSort.dir === 'asc' ? '▲' : '▼') : ''}</span></th>
                            <th data-sort="location" class="sortable">Location <span class="sort-indicator">${this.lotSort.key === 'location' ? (this.lotSort.dir === 'asc' ? '▲' : '▼') : ''}</span></th>
                            <th data-sort="price" class="sortable">Prix <span class="sort-indicator">${this.lotSort.key === 'price' ? (this.lotSort.dir === 'asc' ? '▲' : '▼') : ''}</span></th>
                            <th data-sort="members" class="sortable">Membres <span class="sort-indicator">${this.lotSort.key === 'members' ? (this.lotSort.dir === 'asc' ? '▲' : '▼') : ''}</span></th>
                            <th>Description</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        sortedLots.forEach(lot => {
            const membersWithThisLot = this.members.filter(member => (member.numberOfLots || 0) > 0);
            const totalUnitsForThisLot = membersWithThisLot.reduce((sum, member) => sum + (member.numberOfLots || 0), 0);
            const isSelected = this.selectedLots.has(lot.id);

            html += `
                <tr class="lot-row" data-lot-id="${lot.id}">
                    <td class="cell-select"><input type="checkbox" class="lot-select" data-lot-id="${lot.id}" ${isSelected ? 'checked' : ''}></td>
                    <td class="cell-name" title="Unités vendues: ${totalUnitsForThisLot}">
                        <div class="lot-name-cell">
                            <span class="lot-icon">📦</span>
                            <span>${lot.name}</span>
                        </div>
                    </td>
                    <td class="cell-location">${lot.location || '-'}</td>
                    <td class="cell-price">
                        <span class="price-badge">${this.formatCurrency(lot.price)}</span>
                    </td>
                    <td class="cell-members">
                        <span class="member-count">${membersWithThisLot.length}</span>
                    </td>
                    <td class="cell-description" title="${lot.description || ''}">${lot.description || '-'}</td>
                    <td class="cell-actions">
                        <div class="action-menu">
                            <button class="action-btn" title="Plus d'actions">⋮</button>
                            <div class="action-dropdown">
                                <button class="action-item" data-action="edit" data-lot-id="${lot.id}">
                                    <i class="fas fa-edit"></i> Modifier
                                </button>
                                <button class="action-item" data-action="pdf" data-lot-id="${lot.id}">
                                    <i class="fas fa-file-pdf"></i> Exporter PDF
                                </button>
                                <button class="action-item" data-action="delete" data-lot-id="${lot.id}">
                                    <i class="fas fa-trash"></i> Supprimer
                                </button>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = html;

        const updateStoredSelection = () => {
            localStorage.setItem('selectedLots', JSON.stringify(Array.from(this.selectedLots)));
        };

        container.querySelectorAll('.lot-select').forEach(cb => {
            cb.addEventListener('change', () => {
                const id = cb.dataset.lotId;
                if (cb.checked) this.selectedLots.add(id); else this.selectedLots.delete(id);
                updateStoredSelection();
                this.renderLotsListView(filteredLots);
            });
        });

        const selectAll = container.querySelector('#selectAllLots');
        if (selectAll) {
            selectAll.addEventListener('change', () => {
                if (selectAll.checked) {
                    sortedLots.forEach(l => this.selectedLots.add(l.id));
                } else {
                    sortedLots.forEach(l => this.selectedLots.delete(l.id));
                }
                updateStoredSelection();
                this.renderLotsListView(filteredLots);
            });
        }

        const bulkExport = container.querySelector('#bulkExportLots');
        if (bulkExport) {
            bulkExport.addEventListener('click', () => {
                this.selectedLots.forEach(id => this.exportLotToPDF(id));
            });
        }
        const bulkDelete = container.querySelector('#bulkDeleteLots');
        if (bulkDelete) {
            bulkDelete.addEventListener('click', () => {
                if (!confirm('Supprimer les lots sélectionnés ?')) return;
                this.selectedLots.forEach(id => this.deleteLot(id));
                this.selectedLots.clear();
                updateStoredSelection();
                this.renderLots();
            });
        }

        // Tri des colonnes
        container.querySelectorAll('.lots-table th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const key = th.getAttribute('data-sort');
                if (this.lotSort.key === key) {
                    this.lotSort.dir = this.lotSort.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    this.lotSort = { key, dir: 'asc' };
                }
                localStorage.setItem('lotSortKey', this.lotSort.key);
                localStorage.setItem('lotSortDir', this.lotSort.dir);
                this.renderLots();
            });
        });
        
        // Ajouter les événements des menus d'actions
        this.setupLotsTableActions();
    }

    setupLotsTableActions() {
        // Réutiliser l'attachement centralisé pour éviter duplication
        this.setupTableActions();
    }

    renderLots() {
        // Nouvelle logique : afficher les stats du lot unique
        const lotPrice = this.getUnitPrice();
        
        // Mettre à jour le prix affiché
        const priceDisplay = document.getElementById('currentLotPrice');
        if (priceDisplay) {
            priceDisplay.textContent = this.formatCurrency(lotPrice);
        }
        const unitDisplay = document.getElementById('currentUnitPrice');
        if (unitDisplay) {
            unitDisplay.textContent = this.formatCurrency(lotPrice);
        }
        
        // Calculer les statistiques
        const clientsWithLots = this.members.filter(m => (m.numberOfLots || 0) > 0);
        const totalUnits = clientsWithLots.reduce((sum, m) => sum + (m.numberOfLots || 0), 0);
        const totalExpected = totalUnits * lotPrice;
        const totalCollected = this.payments.reduce((sum, p) => sum + p.amount, 0);
        
        // Mettre à jour les stats
        const statsElements = {
            totalClientsStats: clientsWithLots.length,
            totalUnitsStats: totalUnits,
            totalExpectedStats: this.formatCurrency(totalExpected),
            totalCollectedStats: this.formatCurrency(totalCollected)
        };
        
        Object.entries(statsElements).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        });
        
        // Afficher la liste des clients
        this.renderLotsClientsTable(clientsWithLots, lotPrice);
    }
    
    renderLotsClientsTable(clients, lotPrice) {
        const container = document.getElementById('lotsClientsTable');
        if (!container) return;
        
        if (clients.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>Aucun client n\'a encore acheté de lots</p></div>';
            return;
        }
        
        let html = `
            <table class="clients-lots-table">
                <thead>
                    <tr>
                        <th>Client</th>
                        <th>Nombre de Lots</th>
                        <th>Montant Dû</th>
                        <th>Montant Versé</th>
                        <th>Reste à Payer</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        clients.forEach(client => {
            const numberOfLots = client.numberOfLots || 0;
            const amountDue = numberOfLots * lotPrice;
            const clientPayments = this.payments.filter(p => p.memberId === client.id);
            const amountPaid = clientPayments.reduce((sum, p) => sum + p.amount, 0);
            const remaining = amountDue - amountPaid;
            
            html += `
                <tr>
                    <td><strong>${client.name}</strong></td>
                    <td><span class="badge">${numberOfLots} lot${numberOfLots > 1 ? 's' : ''}</span></td>
                    <td>${this.formatCurrency(amountDue)}</td>
                    <td class="text-success">${this.formatCurrency(amountPaid)}</td>
                    <td class="${remaining > 0 ? 'text-danger' : 'text-success'}">${this.formatCurrency(remaining)}</td>
                </tr>
            `;
        });
        
        html += `
                </tbody>
            </table>
        `;
        
        container.innerHTML = html;
        this.attachGlobalAscendingSortHandlers();
    }

async exportLotToPDF(lotId) {
    try {
        this.showLoader('Génération du rapport lot...');
        const lot = this.lots.find(l => l.id === lotId || l.name === lotId);
        if (!lot) { this.showNotification('Lot introuvable', 'error'); return; }

        const membersWithLot = this.members.filter(m => (Array.isArray(m.lots) && m.lots.includes(lot.id)) || m.selectedLot === lot.id || m.selectedLot === lot.name);

        const totalCollected = membersWithLot.reduce((s,m)=> {
            const mp = this.payments.filter(p=>p.memberId===m.id);
            return s + mp.reduce((ss,p)=>ss+p.amount,0);
        }, 0);
        const expectedTotal = membersWithLot.reduce((s,m)=> s + ((m.monthlyQuota||0) * (m.duration||0)), 0);
        const progress = expectedTotal > 0 ? (totalCollected / expectedTotal) * 100 : (lot.price>0 ? (totalCollected/lot.price)*100 : 0);

      const totalMonths = lot.duration || 0;
        const monthlySum = membersWithLot.reduce((sum, m) => sum + (m.monthlyQuota || 0), 0);
        const monthsPaid = monthlySum > 0 ? Math.floor(totalCollected / monthlySum) : 0;

        const reportContainer = document.createElement('div');
        reportContainer.className = 'pdf-report-container';
        reportContainer.id = 'pdf-report-lot';
        const now = new Date();

        reportContainer.innerHTML = `
            <div class="pdf-header">
                <div class="pdf-logo-section">
                        <img src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QCMRXhpZgAATU0AKgAAAAgABQESAAMAAAABAAEAAAEaAAUAAAABAAAASgEbAAUAAAABAAAAUgEoAAMAAAABAAIAAIdpAAQAAAABAAAAWgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAA8CgAwAEAAAAAQAAA8AAAAAA/8AAEQgDwAPAAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAwMDAwMDBAMDBAYEBAQGCAYGBgYICggICAgICg0KCgoKCgoNDQ0NDQ0NDQ8PDw8PDxISEhISFBQUFBQUFBQUFP/bAEMBAwMDBQUFCQUFCRUODA4VFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFf/dAAQAPP/aAAwDAQACEQMRAD8A/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/0P1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//R/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/0v1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9P9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//1P1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9X9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/W/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9f9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/Q/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/0f1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//S/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/0/1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9T9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//1f1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9b9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/X/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9D9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/R/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADK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AoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9H9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/S/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9P9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/U/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/1f1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//W/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/1/1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9D9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//0f1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9L9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/T/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9T9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/V/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/1v1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//X/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/0P1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9H9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//0v1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9k=" style="height:40px;width:40px;border-radius:50%;" />
                    <div class="pdf-company-info">
                        <h1>TONTINE IMMOBILIER</h1>
                        <p>Rapport Lot • ${lot.name}</p>
                    </div>
                </div>
                <div class="pdf-report-meta">
                    <h2>RAPPORT LOT</h2>
                    <p>Généré le ${now.toLocaleDateString('fr-FR')}</p>
                    <p>Id : ${lot.id}</p>
                </div>
            </div>

            <div class="pdf-metrics-grid">
                <div class="pdf-metric-card metric-collected">
                    <div class="pdf-metric-icon">${this.getSvgIcon('wallet',24)}</div>
                    <div class="pdf-metric-value">${this.formatCurrencyForPDF(totalCollected)}</div>
                    <div class="pdf-metric-label">Total Collecté</div>
                </div>
                <div class="pdf-metric-card metric-expected">
                    <div class="pdf-metric-icon">${this.getSvgIcon('bullseye',24)}</div>
                    <div class="pdf-metric-value">${this.formatCurrencyForPDF(expectedTotal || lot.price)}</div>
                    <div class="pdf-metric-label">Objectif</div>
                </div>
                <div class="pdf-metric-card metric-progress">
                    <div class="pdf-metric-icon">${this.getSvgIcon('percentage',24)}</div>
                    <div class="pdf-metric-value">${Math.round(progress)}%</div>
                    <div class="pdf-metric-label">Progression</div>
                </div>
                <div class="pdf-metric-card metric-members">
                    <div class="pdf-metric-icon">${this.getSvgIcon('users',24)}</div>
                    <div class="pdf-metric-value">${membersWithLot.length}</div>
                    <div class="pdf-metric-label">Membres</div>
                </div>
            </div>

         <div style="margin: 20px 0; font-weight:600; color:#2C3E50;">
    ${monthsPaid} mois payés / ${totalMonths} mois
</div>

            <div class="pdf-section">
                <h3 class="pdf-section-title">${this.getSvgIcon('table',18)} Membres & Paiements</h3>
                <table class="pdf-table">
                    <thead>
                        <tr><th>Nom</th><th>Quota/mois</th><th>Durée</th><th>Total payé</th><th>Progression</th></tr>
                    </thead>
                    <tbody>
                        ${membersWithLot.map(m=>{
                            const mp = this.payments.filter(p=>p.memberId===m.id);
                            const total = mp.reduce((s,p)=>s+p.amount,0);
                            const memberExpected = (m.monthlyQuota||0)*(m.duration||0);
                            const memberProgress = memberExpected>0?Math.round((total/memberExpected)*100):0;
                            return `
                                <tr>
                                    <td>${m.name}</td>
                                    <td>${this.formatCurrencyForPDF(m.monthlyQuota||0)}</td>
                                    <td>${(m.duration||0)} mois</td>
                                    <td style="color:#27AE60;font-weight:600">${this.formatCurrencyForPDF(total)}</td>
                                    <td>${memberProgress}%</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>

            <div class="pdf-section">
                <h3 class="pdf-section-title">Informations du lot</h3>
                <table class="pdf-table">
                    <tbody>
                        <tr><td>Nom</td><td>${lot.name}</td></tr>
                        <tr><td>Prix</td><td>${this.formatCurrencyForPDF(lot.price)}</td></tr>
                        <tr><td>Localisation</td><td>${lot.location || '—'}</td></tr>
                        <tr><td>Description</td><td>${lot.description || '—'}</td></tr>
                    </tbody>
                </table>
            </div>

                <!-- Pied de page -->
                <div class="pdf-footer">
                    <p><strong>SIMMO 2.0</strong> - L'immobilier Autrement</p>
                    <p>Rapport généré  le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}</p>
                    <p>Pour plus d'informations, contactez le ☎️ 01 618 837 90.</p>
                </div>        `;

        document.body.appendChild(reportContainer);
        await new Promise(r=>setTimeout(r,350));
        const canvas = await html2canvas(reportContainer, { scale:2, useCORS:true, backgroundColor:'#ffffff' });
        document.body.removeChild(reportContainer);

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p','mm','a4');
        const img = canvas.toDataURL('image/png');
        const imgWidth = 210; const pageHeight = 295; const imgHeight = (canvas.height * imgWidth) / canvas.width;
        let heightLeft = imgHeight; let position = 0;
        pdf.addImage(img,'PNG',0,position,imgWidth,imgHeight);
        heightLeft -= pageHeight;
        while (heightLeft >= 0) { position = heightLeft - imgHeight; pdf.addPage(); pdf.addImage(img,'PNG',0,position,imgWidth,imgHeight); heightLeft -= pageHeight; }
        pdf.save(`Rapport_Lot_${lot.name.replace(/[^a-zA-Z0-9]/g,'_')}_${new Date().toISOString().slice(0,10)}.pdf`);
        this.hideLoader();
        this.showNotification('Rapport lot généré', 'success');

    } catch (err) {
        console.error(err);
        try { this.hideLoader(); } catch(e){}
        this.showNotification('Erreur génération rapport lot', 'error');
    }
}

    showAddMemberModal() {
        // Récupérer le prix d'un lot (tous les lots ont le même prix). Autoriser création même sans lots.
        const fetchedPrice = this.getUnitPrice();
        const lotPrice = (fetchedPrice == null) ? 1500000 : fetchedPrice;

        const content = `
            <form id="memberForm">
                <div class="form-group">
                    <label class="form-label">Nom</label>
                    <input type="text" class="form-input" id="memberName" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Email</label>
                    <input type="email" class="form-input" id="memberEmail">
                </div>
                <div class="form-group">
                    <label class="form-label">Téléphone</label>
                    <input type="tel" class="form-input" id="memberPhone" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Date de début</label>
                    <input type="date" class="form-input" id="memberStartDate" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Nombre de lots</label>
                    <input type="number" class="form-input" id="memberNumberOfLots" min="1" value="1" required>
                    <small style="color: #666; margin-top: 5px; display: block;">Prix unitaire: ${this.formatCurrency(lotPrice)}${fetchedPrice == null ? ' (par défaut)' : ''}</small>
                </div>
                <div class="form-group">
                    <label class="form-label">Durée de paiement (en mois)</label>
                    <select class="form-input" id="paymentDuration" required>
                        <option value="1">1 mois</option>
                        <option value="2">2 mois</option>
                        <option value="3">3 mois</option>
                        <option value="6">6 mois</option>
                        <option value="12" selected>12 mois</option>
                        <option value="18">18 mois</option>
                        <option value="24">24 mois</option>
                    </select>
                </div>
                <div class="form-group">
                    <div id="monthlyQuotaDisplay" class="quota-display" style="background: #f0f7ff; padding: 12px; border-radius: 6px; border-left: 4px solid #1976d2;">
                        <div><strong>MONTANT Total :</strong> <span id="calculatedTotal" style="font-size: 16px; color: #1976d2; font-weight: 600;">0 FCFA</span></div>
                        <div style="margin-top: 8px;"><strong>Quota mensuel :</strong> <span id="calculatedQuota" style="font-size: 14px; color: #27ae60; font-weight: 600;">0 FCFA</span></div>
                        <div style="margin-top: 8px; font-size: 0.9em; color: #666;">
                            <strong>Date de début :</strong> <span id="calculatedStartDate">-</span>
                        </div>
                        <div style="font-size: 0.9em; color: #666;">
                            <strong>Date de fin :</strong> <span id="calculatedEndDate">-</span>
                        </div>
                    </div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" onclick="app.closeModal()">Annuler</button>
                    <button type="submit" class="btn btn-primary">Ajouter Membre</button>
                </div>
            </form>
        `;

        this.showModal('Ajouter un Membre', content);

        const numberOfLotsInput = document.getElementById('memberNumberOfLots');
        const durationSelect = document.getElementById('paymentDuration');
        const calculatedTotal = document.getElementById('calculatedTotal');
        const calculatedQuota = document.getElementById('calculatedQuota');
        const calculatedStartDate = document.getElementById('calculatedStartDate');
        const calculatedEndDate = document.getElementById('calculatedEndDate');
        const startDateInput = document.getElementById('memberStartDate');

        if (startDateInput) {
            // Default start to July 1, 2025 as requested
            startDateInput.value = '2025-07-01';
        }

        const updateQuota = () => {
            const numberOfLots = parseInt(numberOfLotsInput.value) || 1;
            const duration = parseInt(durationSelect.value);
            const totalPrice = numberOfLots * lotPrice;
            const monthlyQuotaRaw = duration > 0 ? totalPrice / duration : 0;
            const monthlyQuota = Math.round(monthlyQuotaRaw / 100) * 100;

            calculatedTotal.textContent = this.formatCurrency(totalPrice);
            calculatedQuota.textContent = this.formatCurrency(monthlyQuota);

            // Calculer et afficher les dates
            const startDateValue = startDateInput && startDateInput.value ? new Date(startDateInput.value) : new Date();
            const safeStartDate = isNaN(startDateValue.getTime()) ? new Date() : startDateValue;
            const endDate = new Date(safeStartDate);
            endDate.setMonth(endDate.getMonth() + duration);
            // Show end as the last day of the previous month (e.g., for 12 months from July -> end in June)
            endDate.setDate(endDate.getDate() - 1);

            calculatedStartDate.textContent = this.formatDate(safeStartDate.toISOString());
            calculatedEndDate.textContent = this.formatDate(endDate.toISOString());
        };

        numberOfLotsInput.addEventListener('change', updateQuota);
        numberOfLotsInput.addEventListener('input', updateQuota);
        durationSelect.addEventListener('change', updateQuota);
        if (startDateInput) {
            startDateInput.addEventListener('change', updateQuota);
        }

        updateQuota();

        document.getElementById('memberForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addMember();
        });
    }

    showAddPaymentModal(memberId = null) {
        const content = `
            <form id="paymentForm">
                <div class="form-group">
                    <label class="form-label">Sélectionner un Membre</label>
                    <select class="form-input" id="paymentMemberSelect" required>
                        <option value="">Choisir un membre</option>
                    </select>
                </div>

                <div id="selectedMemberInfo" class="selected-member-info" style="display: none;">
                    <div class="member-info-card">
                        <h4 id="selectedMemberName"></h4>
                        <p id="selectedMemberDetails"></p>
                    </div>
                </div>

                <div class="form-group" id="monthSelectGroup" style="display: none;">
                    <label class="form-label">Mois de Paiement</label>
                    <select class="form-input" id="paymentMonth">
                        <option value="">Sélectionner un mois</option>
                    </select>
                </div>

                <div class="form-group">
                    <label class="form-label">Date de Paiement</label>
                    <input type="date" class="form-input" id="paymentDate" required>
                </div>

                <div class="form-group">
                    <label class="form-label">Montant</label>
                    <input type="number" class="form-input" id="paymentAmount" min="0" step="1" placeholder="Saisir le montant" required>
                    <div class="helper-text" id="suggestedAmount" style="font-size: 0.9em; color: #666; margin-top: 6px; display: none;"></div>
                    <div class="helper-text" id="remainingAmount" style="font-size: 0.9em; color: #444; margin-top: 4px; display: none;"></div>
                </div>

                <div id="quotaWarning" class="quota-warning" style="display: none;">
                    Ce paiement dépassera le quota mensuel du membre!
                </div>

                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" onclick="app.closeModal()">Annuler</button>
                    <button type="submit" class="btn btn-primary" id="submitPayment" disabled>Ajouter Paiement</button>
                </div>
            </form>
        `;

        this.showModal('Ajouter un Paiement', content);

        document.getElementById('paymentDate').value = new Date().toISOString().split('T')[0];

        this.setupPaymentFormListeners(memberId);
    }

    setupPaymentFormListeners(preselectedMemberId = null) {
        const memberSelect = document.getElementById('paymentMemberSelect');
        const selectedMemberInfo = document.getElementById('selectedMemberInfo');
        const monthSelect = document.getElementById('paymentMonth');
        const monthSelectGroup = document.getElementById('monthSelectGroup');
        const amountInput = document.getElementById('paymentAmount');
        const suggestedAmount = document.getElementById('suggestedAmount');
        const remainingAmount = document.getElementById('remainingAmount');
        const submitBtn = document.getElementById('submitPayment');
        const warningDiv = document.getElementById('quotaWarning');

        const computeRemaining = (member) => {
            const totalDue = (member.paymentDuration || 12) * (member.monthlyQuota || 0);
            const paid = this.payments
                .filter(p => p.memberId === member.id)
                .reduce((sum, p) => sum + (p.amount || 0), 0);
            return Math.max(totalDue - paid, 0);
        };

        let selectedMember = null;
        let selectedMonth = null;

        // Peupler la liste des membres
        if (memberSelect) {
            memberSelect.innerHTML = '<option value="">Choisir un membre</option>' + this.members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
            if (preselectedMemberId) {
                memberSelect.value = preselectedMemberId;
            }
        }

        const applyMemberSelection = (member) => {
            if (!member) return;
            this.displaySelectedMember(member);
            const autoMonth = this.populateMonthsForMember(member);

            // Arrondir la suggestion au pas de 100 FCFA
            const roundedMonthlyQuota = Math.round((member.monthlyQuota || 0) / 100) * 100;

            if (amountInput) {
                amountInput.value = roundedMonthlyQuota || '';
                amountInput.min = 0;
                amountInput.step = '1';
                if (suggestedAmount) {
                    suggestedAmount.textContent = `Montant suggéré: ${this.formatCurrency(roundedMonthlyQuota || 0)}`;
                    suggestedAmount.style.display = 'block';
                }
                if (remainingAmount) {
                    const remaining = computeRemaining(member);
                    remainingAmount.textContent = `Montant restant: ${this.formatCurrency(remaining)}`;
                    remainingAmount.style.display = 'block';
                    amountInput.max = remaining;
                }
            }

            if (autoMonth) {
                selectedMonth = autoMonth;
                this.calculateAndDisplayAmount(member, autoMonth);
                submitBtn.disabled = false;
            }
        };

        // Si un membre est préselectionné
        if (preselectedMemberId) {
            selectedMember = this.members.find(m => m.id === preselectedMemberId) || null;
            if (selectedMember) {
                applyMemberSelection(selectedMember);
            }
        }

        // Sélection via la liste déroulante
        if (memberSelect) {
            memberSelect.addEventListener('change', (e) => {
                const memberId = e.target.value;
                selectedMember = this.members.find(m => m.id === memberId) || null;

                if (selectedMember) {
                    applyMemberSelection(selectedMember);
                } else {
                    selectedMemberInfo.style.display = 'none';
                    monthSelectGroup.style.display = 'none';
                    amountInput.value = '';
                    if (suggestedAmount) suggestedAmount.style.display = 'none';
                    if (remainingAmount) remainingAmount.style.display = 'none';
                    submitBtn.disabled = true;
                }
            });
        }

        monthSelect.addEventListener('change', (e) => {
            selectedMonth = e.target.value;
            if (selectedMember && selectedMonth) {
                this.calculateAndDisplayAmount(selectedMember, selectedMonth);
            } else if (selectedMember) {
                const autoMonth = this.populateMonthsForMember(selectedMember);
                selectedMonth = autoMonth || null;
                if (autoMonth) {
                    this.calculateAndDisplayAmount(selectedMember, autoMonth);
                    submitBtn.disabled = false;
                } else {
                    submitBtn.disabled = true;
                }
            } else {
                if (suggestedAmount) suggestedAmount.style.display = 'none';
                if (remainingAmount) remainingAmount.style.display = 'none';
                submitBtn.disabled = true;
            }
        });

        if (amountInput) {
            amountInput.addEventListener('input', () => {
                if (!selectedMember) return;
                const remaining = computeRemaining(selectedMember);
                if (remainingAmount) {
                    remainingAmount.textContent = `Montant restant: ${this.formatCurrency(remaining)}`;
                    remainingAmount.style.display = 'block';
                }

                if (amountInput.value === '') return;
                const val = parseFloat(amountInput.value);
                if (!isNaN(val) && val > remaining) {
                    amountInput.value = remaining > 0 ? remaining : '';
                    this.showToast('Montant ne peut pas dépasser le reste à payer', 'error');
                }
            });
        }

        document.getElementById('paymentForm').addEventListener('submit', (e) => {
            e.preventDefault();
            if (selectedMember && selectedMonth) {
                this.addPaymentWithReceipt(selectedMember, selectedMonth);
            } else {
                this.showToast('Veuillez sélectionner un membre et un mois', 'error');
            }
        });
    }

    displaySelectedMember(member) {

        const memberLots = member.lots ? member.lots.map(lotId => {
            const lot = this.lots.find(l => l.id === lotId);
            return lot ? lot.name : 'Lot inconnu';
        }).join(', ') : 'Aucun lot assigné';

        const nameEl = document.getElementById('selectedMemberName');
        const detailsEl = document.getElementById('selectedMemberDetails');
        if (nameEl) nameEl.textContent = member.name;

        if (detailsEl) {
            const contactParts = [];
            if (member.email) contactParts.push(member.email);
            if (member.phone) contactParts.push(member.phone);
            const contactLine = contactParts.length ? contactParts.join(' • ') : '—';

            detailsEl.innerHTML =
                `${contactLine}<br>
                <strong>Lots:</strong> ${memberLots}<br>
                <strong>Quota mensuel:</strong> ${this.formatCurrency(member.monthlyQuota)} •
                <strong>Durée:</strong> ${member.paymentDuration} mois`;
        }
        document.getElementById('selectedMemberInfo').style.display = 'block';
    }

    getMemberMonths(member) {
        const months = [];
        const duration = member.paymentDuration || member.duration || 12;
        const start = new Date(member.startDate || member.createdAt || new Date());
        start.setHours(0, 0, 0, 0);

        for (let i = 0; i < duration; i++) {
            const d = new Date(start);
            d.setMonth(d.getMonth() + i);
            months.push(`${d.getFullYear()}-${d.getMonth()}`);
        }
        return months;
    }

    populateMonthsForMember(member) {
        const monthSelect = document.getElementById('paymentMonth');
        const monthSelectGroup = document.getElementById('monthSelectGroup');

        console.log('Populating months for member:', member.name, 'Duration:', member.paymentDuration);

        const monthNames = [
            'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
            'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
        ];

        const paymentsByMonth = this.payments
            .filter(p => p.memberId === member.id)
            .reduce((acc, p) => {
                const key = p.monthKey ? p.monthKey : (() => {
                    const d = new Date(p.date);
                    return `${d.getFullYear()}-${d.getMonth()}`;
                })();
                acc[key] = (acc[key] || 0) + (p.amount || 0);
                return acc;
            }, {});

        console.log('Payments by month:', paymentsByMonth);

        monthSelect.innerHTML = '<option value="">Sélectionner un mois</option>';

        const monthKeys = this.getMemberMonths(member);
        let optionsAdded = 0;
        let firstUnpaid = '';

        monthKeys.forEach(monthKey => {
            const [year, month] = monthKey.split('-').map(Number);
            const alreadyPaid = paymentsByMonth[monthKey] || 0;
            const remainingForMonth = Math.max((member.monthlyQuota || 0) - alreadyPaid, 0);
            const option = document.createElement('option');
            option.value = monthKey;
            option.textContent = remainingForMonth > 0
                ? `${monthNames[month]} ${year}`
                : `${monthNames[month]} ${year} (déjà payé)`;
            monthSelect.appendChild(option);
            optionsAdded++;
            if (!firstUnpaid && remainingForMonth > 0) {
                firstUnpaid = monthKey;
            }
            console.log('Added month:', monthNames[month], year, 'remaining:', remainingForMonth);
        });

        if (optionsAdded === 0) {
            monthSelect.innerHTML = '<option value="">Tous les mois sont payés</option>';
        }

        if (firstUnpaid) {
            monthSelect.value = firstUnpaid;
        } else if (monthKeys.length > 0) {
            monthSelect.value = monthKeys[0];
        }

        console.log('Total options added:', optionsAdded, 'firstUnpaid:', firstUnpaid);
        monthSelectGroup.style.display = 'block';

        return monthSelect.value || '';
    }

    calculateAndDisplayAmount(member, monthKey) {
        const submitBtn = document.getElementById('submitPayment');
        const warningDiv = document.getElementById('quotaWarning');
        const amountInput = document.getElementById('paymentAmount');
        const suggestedAmount = document.getElementById('suggestedAmount');
        const remainingAmount = document.getElementById('remainingAmount');

        const roundedMonthlyQuota = Math.round((member.monthlyQuota || 0) / 100) * 100;
        const totalDue = (member.paymentDuration || 12) * roundedMonthlyQuota;
        const paid = this.payments
            .filter(p => p.memberId === member.id)
            .reduce((sum, p) => sum + (p.amount || 0), 0);
        const remaining = Math.max(totalDue - paid, 0);

        if (amountInput) {
            amountInput.max = remaining;
            if (amountInput.value === '') {
                const fallback = roundedMonthlyQuota || 0;
                const clamped = remaining > 0 ? Math.min(fallback, remaining) : '';
                amountInput.value = clamped;
            } else {
                const val = parseFloat(amountInput.value);
                if (!isNaN(val) && val > remaining) {
                    amountInput.value = remaining > 0 ? remaining : '';
                }
            }
        }

        if (amountInput && (amountInput.value === '' || amountInput.value === '0')) {
            amountInput.value = roundedMonthlyQuota || '';
        }

        const [year, month] = monthKey.split('-');
        const existingPayments = this.payments.filter(p => {
            if (p.monthKey) {
                return p.memberId === member.id && p.monthKey === monthKey;
            }
            const paymentDate = new Date(p.date);
            return p.memberId === member.id &&
                   paymentDate.getFullYear() === parseInt(year) &&
                   paymentDate.getMonth() === parseInt(month);
        });

        if (existingPayments.length > 0) {
            // On ne montre plus le warning, mais on autorise le paiement supplémentaire
            warningDiv.style.display = 'none';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Ajouter Paiement';
        } else {
            warningDiv.style.display = 'none';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Ajouter Paiement';
        }

        if (suggestedAmount) {
            suggestedAmount.textContent = `Montant suggéré: ${this.formatCurrency(member.monthlyQuota || 0)}`;
            suggestedAmount.style.display = 'block';
        }

        if (remainingAmount) {
            remainingAmount.textContent = `Montant restant: ${this.formatCurrency(remaining)}`;
            remainingAmount.style.display = 'block';
        }

        console.log('Montant libre, suggestion:', member.monthlyQuota, 'pour le membre:', member.name, 'mois:', monthKey);
    }

    addPaymentWithReceipt(member, monthKey) {
        const paymentDate = document.getElementById('paymentDate').value;
        const amountInput = document.getElementById('paymentAmount');
        const amount = amountInput ? parseFloat(amountInput.value) : member.monthlyQuota;

        const totalDue = (member.paymentDuration || 12) * (member.monthlyQuota || 0);
        const paid = this.payments
            .filter(p => p.memberId === member.id)
            .reduce((sum, p) => sum + (p.amount || 0), 0);
        const remaining = Math.max(totalDue - paid, 0);

        if (!amount || amount <= 0 || isNaN(amount)) {
            this.showToast('Montant invalide', 'error');
            return;
        }

        if (amount > remaining + 0.0001) {
            this.showToast('Montant supérieur au reste à payer', 'error');
            return;
        }

        const monthKeys = this.getMemberMonths(member);
        let startIndex = -1;
        if (monthKey) {
            startIndex = monthKeys.findIndex(m => m === monthKey);
        }
        if (startIndex < 0) {
            startIndex = monthKeys.findIndex(mk => {
                const alreadyPaid = this.payments
                    .filter(p => p.memberId === member.id && p.monthKey === mk)
                    .reduce((sum, p) => sum + (p.amount || 0), 0);
                return (member.monthlyQuota || 0) - alreadyPaid > 0.0001;
            });
        }
        if (startIndex < 0) startIndex = 0;

        let remainingAmount = amount;
        const paymentsToAdd = [];

        for (let i = startIndex; i < monthKeys.length && remainingAmount > 0; i++) {
            const mk = monthKeys[i];
            const alreadyPaidForMonth = this.payments
                .filter(p => p.memberId === member.id && p.monthKey === mk)
                .reduce((sum, p) => sum + (p.amount || 0), 0);
            const needed = Math.max((member.monthlyQuota || 0) - alreadyPaidForMonth, 0);
            if (needed <= 0) continue;

            const toPay = Math.min(remainingAmount, needed);
            paymentsToAdd.push({
                id: this.generateId(),
                memberId: member.id,
                amount: toPay,
                date: paymentDate,
                monthKey: mk,
                createdAt: new Date().toISOString()
            });
            remainingAmount -= toPay;
        }

        if (paymentsToAdd.length === 0) {
            this.showToast('Aucun mois à compléter avec ce montant', 'error');
            return;
        }

        const monthNames = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
        const monthsCoveredKeys = paymentsToAdd.map(p => p.monthKey);
        const monthsCoveredLabels = monthsCoveredKeys.map(mk => {
            const [y, m] = mk.split('-');
            return `${monthNames[parseInt(m, 10)]} ${y}`;
        });
        paymentsToAdd.forEach(p => { p.monthsCovered = monthsCoveredLabels; });

        this.payments.push(...paymentsToAdd);
        this.saveData();
        this.closeModal();
        this.updateUI();
        this.updateStats();

        this.showToast(`Paiement réparti sur: ${monthsCoveredLabels.join(', ')}`);

        this.generatePaymentReceipt(paymentsToAdd[0], member, monthsCoveredLabels);
    }

async generatePaymentReceipt(payment, member, monthsCovered) {
    try {

        if (!member && payment && typeof payment === 'string') {
            const pay = this.payments.find(p => p.id === payment);
            if (!pay) { this.showToast('Paiement introuvable', 'error'); return; }
            payment = pay;
            member = this.members.find(m => m.id === payment.memberId);
            if (!member) { this.showToast('Membre introuvable', 'error'); return; }
        }

        const receiptDate = this.formatDate(payment.date || new Date().toISOString());
        const monthNames = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
        const formatMonthKey = (mk) => {
            const [y, m] = mk.split('-');
            return `${monthNames[parseInt(m, 10)]} ${y}`;
        };

        const monthsSource = Array.isArray(monthsCovered) && monthsCovered.length
            ? monthsCovered
            : (Array.isArray(payment.monthsCovered) && payment.monthsCovered.length ? payment.monthsCovered : (payment.monthKey ? [payment.monthKey] : []));
        const monthsDisplay = monthsSource.map(m => (typeof m === 'string' && m.includes('-')) ? formatMonthKey(m) : m).join(', ');

        const memberLots = member.lots ? member.lots.map(id => {
            const l = this.lots.find(x => x.id === id);
            return l ? l.name : 'Lot inconnu';
        }).join(', ') : (member.selectedLot ? (this.lots.find(l => l.id === member.selectedLot || l.name === member.selectedLot)?.name || member.selectedLot) : 'Aucun lot');

        const amountReadable = this.formatCurrency(payment.amount || 0);

        const reportContainer = document.createElement('div');
        reportContainer.className = 'pdf-report-container receipt-vertical';

        reportContainer.style.width = '794px';
        reportContainer.style.background = '#ffffff';
        reportContainer.style.color = '#222';
        reportContainer.style.padding = '28px';
        reportContainer.style.boxSizing = 'border-box';
        reportContainer.style.fontFamily = "'Inter', Arial, sans-serif";

        reportContainer.innerHTML = `
            <div class="receipt">
                <div class="receipt-header">
                    <div class="receipt-company">
                        <img src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QCMRXhpZgAATU0AKgAAAAgABQESAAMAAAABAAEAAAEaAAUAAAABAAAASgEbAAUAAAABAAAAUgEoAAMAAAABAAIAAIdpAAQAAAABAAAAWgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAA8CgAwAEAAAAAQAAA8AAAAAA/8AAEQgDwAPAAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAwMDAwMDBAMDBAYEBAQGCAYGBgYICggICAgICg0KCgoKCgoNDQ0NDQ0NDQ8PDw8PDxISEhISFBQUFBQUFBQUFP/bAEMBAwMDBQUFCQUFCRUODA4VFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFf/dAAQAPP/aAAwDAQACEQMRAD8A/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/0P1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//R/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/0v1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9P9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//1P1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9X9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/W/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9f9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/Q/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/0f1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//S/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/0/1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9T9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//1f1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9b9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/X/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9D9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/R/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADK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AoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9H9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/S/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9P9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/U/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/1f1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//W/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/1/1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9D9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//0f1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9L9TafRRVkDKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAMp9FFADKKfRQAUyn0UAf/T/U2n0yn1ZAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoAKfTKfQAyiiigB9Mp9MoA//9T9UKKZT6sgKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAPoplPoAKKZRQA+iimUAf/V/U2n0UVZAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FADKfRRQAyin0UAFMp9FAH/1v1Np9Mp9WQMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKACn0yn0AMooooAfTKfTKAP//X/VCimU+rICimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAD6KZT6ACimUUAPooplAH/0P1Np9FFWQMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQAyn0UUAMop9FABTKfRQB/9H9TafTKfVkDKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygAp9Mp9ADKKKKAH0yn0ygD//0v1QoplPqyAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQA+imU+gAoplFAD6KKZQB/9k=" style="height:40px;width:40px;border-radius:50%;" />
                        <div style="display:inline-block;margin-left:12px;">
                            <div style="font-weight:700;font-size:18px;">CI Habitat IMMOBILIER</div>
                            <div style="font-size:12px;color:#666;">Reçu de paiement • Côte d'Ivoire</div>
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-weight:700;">Reçu N°: ${payment.id || ''}</div>
                        <div style="font-size:12px;color:#666;">Date: ${receiptDate}</div>
                    </div>
                </div>

                <hr style="border:none;border-top:1px solid #EEE;margin:16px 0;">

                <div class="receipt-details" style="margin-top:8px;">
                    <div class="receipt-row"><div class="receipt-label">Membre</div><div>${member.name}</div></div>
                    <div class="receipt-row"><div class="receipt-label">Téléphone</div><div>${member.phone || '—'}</div></div>
                    <div class="receipt-row"><div class="receipt-label">E-mail</div><div>${member.email || '—'}</div></div>
                    <div class="receipt-row"><div class="receipt-label">Lot</div><div>${memberLots}</div></div>
                    <div class="receipt-row"><div class="receipt-label">Mois couverts</div><div>${monthsDisplay || '—'}</div></div>
                </div>

                <div class="receipt-amount" style="margin-top:18px;">
                    <div class="receipt-amount-label">Montant Reçu</div>
                    <div class="receipt-amount-value" style="font-size:28px;font-weight:800;margin-top:6px;color:#27AE60;">${amountReadable}</div>
                </div>

                <div class="receipt-footer" style="margin-top:20px;color:#666;font-size:12px;">
                    <div>Mode de paiement: ${payment.method || 'Espèces / Mobile money'}</div>
                    <div style="margin-top:6px;">Référence: ${payment.reference || '—'}</div>
                </div>

                <!-- SIGNATURES -->
                <div class="receipt-signatures" style="margin-top:48px;display:flex;gap:24px;justify-content:space-between;">
                    <div class="signature-block" style="flex:1;text-align:center;">
                        <div class="signature-line" style="border-top:2px solid #333;width:80%;margin:26px auto 6px;height:1px;"></div>
                        <div class="signature-label" style="font-size:12px;color:#555;">Signature du client</div>
                    </div>
                    <div class="signature-block" style="flex:1;text-align:center;">
                        <div class="signature-line" style="border-top:2px solid #333;width:80%;margin:26px auto 6px;height:1px;"></div>
                        <div class="signature-label" style="font-size:12px;color:#555;">Signature du trésorier</div>
                    </div>
                </div>

                <div style="margin-top:20px;font-size:11px;color:#999;text-align:center;">
                    Merci pour votre paiement.
                </div>
            </div>
        `;

        document.body.appendChild(reportContainer);

        await new Promise(r => setTimeout(r, 300));

        const canvas = await html2canvas(reportContainer, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
        document.body.removeChild(reportContainer);

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgData = canvas.toDataURL('image/png');

        const margin = 10;
        const pageWidth = pdf.internal.pageSize.getWidth();
        const usableWidth = pageWidth - (margin * 2);
        const imgProps = pdf.getImageProperties(imgData);
        const imgWidthMM = usableWidth;
        const imgHeightMM = (imgProps.height * imgWidthMM) / imgProps.width;

        let position = margin;
        pdf.addImage(imgData, 'PNG', margin, position, imgWidthMM, imgHeightMM);

        const pageHeight = pdf.internal.pageSize.getHeight();
        let heightLeft = imgHeightMM - (pageHeight - margin * 2);
        while (heightLeft > 0) {
            pdf.addPage();
            position = margin - (imgHeightMM - heightLeft);
            pdf.addImage(imgData, 'PNG', margin, position, imgWidthMM, imgHeightMM);
            heightLeft -= (pageHeight - margin * 2);
        }

        const fileName = `Recu_${member.name.replace(/[^a-zA-Z0-9]/g,'_')}_${(new Date()).toISOString().slice(0,10)}.pdf`;
        pdf.save(fileName);

        this.showNotification('Reçu PDF généré', 'success');

    } catch (error) {
        console.error('Erreur génération reçu :', error);
        this.showNotification('Erreur lors de la génération du reçu', 'error');
    }
}

    showAddLotModal() {
        const content = `
            <form id="lotForm">
                <div class="form-group">
                    <label class="form-label">Nom du Lot</label>
                    <input type="text" class="form-input" id="lotName" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Prix (FCFA)</label>
                    <input type="number" class="form-input" id="lotPrice" min="0" step="1" required>
                </div>

                <div class="form-group">
                    <label class="form-label">Photos du lot</label>
                    <input type="file" id="lotPhotos" accept="image/*" multiple class="form-input">
                    <small style="color: #5D6D7E; display: block; margin-top: 5px;">Vous pouvez sélectionner plusieurs photos</small>
                    <div id="photoPreviewContainer" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 10px; margin-top: 10px;"></div>
                </div>

                <div class="form-group">
                    <label class="form-label">Description</label>
                    <textarea class="form-input" id="lotDescription" rows="3" required></textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">Localisation</label>
                    <input type="text" class="form-input" id="lotLocation" required>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" onclick="window.paymentManager.closeModal()">Annuler</button>
                    <button type="submit" class="btn btn-primary">Ajouter Lot</button>
                </div>
            </form>
        `;

        this.showModal('Ajouter un Lot', content);
        
        // Prévisualisation des photos
        const photosInput = document.getElementById('lotPhotos');
        const previewContainer = document.getElementById('photoPreviewContainer');
        
        photosInput.addEventListener('change', (e) => {
            previewContainer.innerHTML = '';
            const files = Array.from(e.target.files);
            
            files.forEach((file, index) => {
                if (file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const img = document.createElement('img');
                        img.src = event.target.result;
                        img.style.width = '100%';
                        img.style.height = '100px';
                        img.style.objectFit = 'cover';
                        img.style.borderRadius = '8px';
                        img.style.border = '2px solid #E0E6ED';
                        previewContainer.appendChild(img);
                    };
                    reader.readAsDataURL(file);
                }
            });
        });

        document.getElementById('lotForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addLot();
        });
    }

    showModal(title, content) {
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalContent').innerHTML = content;
        const overlay = document.getElementById('modalOverlay');
        const modalEl = document.getElementById('modal');
        // Save current scroll so we can restore it on close
        try { window._lastScrollY = window.scrollY || window.pageYOffset || 0; } catch (e) {}
        // Ensure overlay is visible
        overlay.classList.add('active');
        // Prevent background from scrolling
        try { document.body.classList.add('modal-open'); } catch (e) {}
        // Make modal focusable and focus it without scrolling the viewport
        if (modalEl) {
            modalEl.setAttribute('tabindex', '-1');
            try { modalEl.focus({ preventScroll: true }); } catch (e) { modalEl.focus(); }
        }
        // Small timeout to ensure layout settled then center overlay content
        setTimeout(() => {
            if (modalEl && typeof modalEl.scrollIntoView === 'function') {
                modalEl.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
            }
        }, 20);
    }

    closeModal() {
        const modal = document.getElementById('modalOverlay');
        modal.classList.remove('active');
        try { document.body.classList.remove('modal-open'); } catch (e) {}
        // Restore previous scroll position smoothly
        try { const y = window._lastScrollY || 0; window.scrollTo({ top: y, behavior: 'smooth' }); window._lastScrollY = null; } catch (e) {}
        
        // Réinitialiser tous les formulaires dans la modal
        const forms = modal.querySelectorAll('form');
        forms.forEach(form => form.reset());
        
        // Réinitialiser les champs cachés
        const memberSearch = document.getElementById('memberSearch');
        if (memberSearch) memberSearch.value = '';
        
        const selectedMemberInfo = document.getElementById('selectedMemberInfo');
        if (selectedMemberInfo) selectedMemberInfo.style.display = 'none';
        
        const monthSelectGroup = document.getElementById('monthSelectGroup');
        if (monthSelectGroup) monthSelectGroup.style.display = 'none';
        
        const searchResults = document.getElementById('searchResults');
        if (searchResults) {
            searchResults.innerHTML = '';
            searchResults.style.display = 'none';
        }
        
        const quotaWarning = document.getElementById('quotaWarning');
        if (quotaWarning) quotaWarning.style.display = 'none';
        
        // Réinitialiser les champs de paiement
        const paymentDate = document.getElementById('paymentDate');
        if (paymentDate) paymentDate.value = '';
        
        const paymentAmount = document.getElementById('paymentAmount');
        if (paymentAmount) paymentAmount.value = '';
    }

addMember(memberData) {
    const newMember = {
        id: this.generateId(),
        name: memberData.name,
        phone: memberData.phone,
        email: memberData.email,
        selectedLot: memberData.selectedLot,
        monthlyQuota: parseFloat(memberData.monthlyQuota),
        duration: parseInt(memberData.duration),
        createdAt: new Date().toISOString()
    };

    this.members.push(newMember);
    this.saveData();
}

    addMember() {
        // Allow adding members even if no lots exist; unit price will default to 0 if not configured
        const name = document.getElementById('memberName').value;
        const email = document.getElementById('memberEmail').value;
        const phone = document.getElementById('memberPhone').value;
        const startDateInput = document.getElementById('memberStartDate').value;
        const numberOfLots = parseInt(document.getElementById('memberNumberOfLots').value) || 1;
        const paymentDuration = parseInt(document.getElementById('paymentDuration').value);

        // Récupérer le prix unitaire d'un lot
        const fetchedPrice = this.getUnitPrice();
        const lotPrice = (fetchedPrice == null) ? 1500000 : fetchedPrice;
        const totalPrice = numberOfLots * lotPrice;
        const monthlyQuota = paymentDuration > 0 ? Math.round((totalPrice / paymentDuration) / 100) * 100 : 0;

        // Calculer les dates de début et fin
        const parsedStartDate = startDateInput ? new Date(startDateInput) : new Date();
        const startDate = isNaN(parsedStartDate.getTime()) ? new Date() : parsedStartDate;
        const endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + paymentDuration);
        // Store endDate as the last day before the next month so 12 months from July -> ends in June
        endDate.setDate(endDate.getDate() - 1);

        const member = {
            id: this.generateId(),
            name,
            email,
            phone,
            numberOfLots,  // Nombre de lots
            // stocker la durée sous deux clés pour compatibilité
            paymentDuration,
            duration: paymentDuration,
            // stocker le prix unitaire et le montant total calculé
            unitPrice: lotPrice,
            totalLotAmount: totalPrice,
            monthlyQuota,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            createdAt: new Date().toISOString()
        };

        this.members.push(member);
        this.saveData();
        this.closeModal();
        this.updateUI();
        this.updateStats();
        this.showToast('Membre ajouté avec succès!');
        
        // Ajouter une notification
        if (typeof addNotification === 'function') {
            addNotification(
                'info',
                'Nouveau membre ajouté',
                `${name} a été ajouté avec succès (${numberOfLots} lots, ${paymentDuration} mois)`,
                { memberId: member.id, name: name }
            );
        }
    }

    addPayment() {
        const memberId = document.getElementById('paymentMember')?.value;
        const amount = parseFloat(document.getElementById('paymentAmount')?.value);
        const date = document.getElementById('paymentDate')?.value;

        if (memberId && amount && date) {
            const payment = {
                id: this.generateId(),
                memberId,
                amount,
                date,
                createdAt: new Date().toISOString()
            };

            this.payments.push(payment);
            this.saveData();
            this.closeModal();
            this.updateUI();
            this.updateStats();
            this.showToast('Paiement ajouté avec succès!');
            
            // Ajouter une notification
            if (typeof addNotification === 'function') {
                const member = this.members.find(m => m.id === memberId);
                if (member) {
                    addNotification(
                        'payment',
                        'Nouveau paiement enregistré',
                        `${member.name} a payé ${this.formatCurrency(amount)}`,
                        { paymentId: payment.id, memberId: memberId, amount: amount }
                    );
                }
            }
        }
    }

    addLot() {
        const name = document.getElementById('lotName').value;
        const price = parseFloat(document.getElementById('lotPrice').value);
        const description = document.getElementById('lotDescription').value;
        const location = document.getElementById('lotLocation').value;
        const photosInput = document.getElementById('lotPhotos');
        
        const photos = [];
        const files = Array.from(photosInput.files);
        
        // Convertir les photos en base64
        let processedFiles = 0;
        
        const processFiles = () => {
            if (files.length === 0 || processedFiles === files.length) {
                // Sauvegarder le lot avec ou sans photos
                const lot = {
                    id: this.generateId(),
                    name,
                    price,
                    description,
                    location,
                    photos: photos,
                    available: true,
                    createdAt: new Date().toISOString()
                };

                this.lots.push(lot);
                this.saveLots();
                this.closeModal();
                this.updateUI();
                this.showNotification('Lot ajouté avec succès!', 'success');
            }
        };
        
        if (files.length > 0) {
            files.forEach((file, index) => {
                if (file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        photos.push({
                            id: this.generateId(),
                            data: event.target.result,
                            name: file.name
                        });
                        processedFiles++;
                        processFiles();
                    };
                    reader.readAsDataURL(file);
                } else {
                    processedFiles++;
                    processFiles();
                }
            });
        } else {
            processFiles();
        }
    }

    editMember(memberId) {
        const member = this.members.find(m => m.id === memberId);
        if (!member) return;

        const lotPrice = this.getUnitPrice();
        const totalAmount = (member.numberOfLots || 1) * lotPrice;

        const content = `
            <form id="editMemberForm">
                <div class="form-group">
                    <label class="form-label">Nom</label>
                    <input type="text" class="form-input" id="editMemberName" value="${member.name}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Email</label>
                    <input type="email" class="form-input" id="editMemberEmail" value="${member.email}">
                </div>
                <div class="form-group">
                    <label class="form-label">Téléphone</label>
                    <input type="tel" class="form-input" id="editMemberPhone" value="${member.phone}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Nombre de lots</label>
                    <input type="number" class="form-input" id="editMemberNumberOfLots" min="1" value="${member.numberOfLots || 1}" required>
                    <small style="color: #666; margin-top: 5px; display: block;">Prix unitaire: ${this.formatCurrency(lotPrice)}</small>
                </div>
                <div class="form-group">
                    <label class="form-label">Durée de paiement (en mois)</label>
                    <select class="form-input" id="editPaymentDuration" required>
                        <option value="1" ${member.paymentDuration === 1 ? 'selected' : ''}>1 mois</option>
                        <option value="2" ${member.paymentDuration === 2 ? 'selected' : ''}>2 mois</option>
                        <option value="3" ${member.paymentDuration === 3 ? 'selected' : ''}>3 mois</option>
                        <option value="6" ${member.paymentDuration === 6 ? 'selected' : ''}>6 mois</option>
                        <option value="12" ${member.paymentDuration === 12 ? 'selected' : ''}>12 mois</option>
                    </select>
                </div>
                <div class="form-group">
                    <div id="editMonthlyQuotaDisplay" class="quota-display" style="background: #f0f7ff; padding: 12px; border-radius: 6px; border-left: 4px solid #1976d2;">
                        <strong>MONTANT Total :</strong> <span id="editTotalAmount" style="font-size: 16px; color: #1976d2; font-weight: 600;">${this.formatCurrency(totalAmount)}</span><br>
                        <strong>Quota mensuel :</strong> <span id="editCalculatedQuota" style="font-size: 14px; color: #27ae60; font-weight: 600;">${this.formatCurrency(member.monthlyQuota)}</span>
                    </div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" onclick="app.closeModal()">Annuler</button>
                    <button type="submit" class="btn btn-primary">Modifier</button>
                </div>
            </form>
        `;

        this.showModal('Modifier le Membre', content);

        const numberOfLotsInput = document.getElementById('editMemberNumberOfLots');
        const durationSelect = document.getElementById('editPaymentDuration');
        const totalAmountDisplay = document.getElementById('editTotalAmount');
        const calculatedQuotaDisplay = document.getElementById('editCalculatedQuota');

        const updateQuota = () => {
            const numberOfLots = parseInt(numberOfLotsInput.value) || 1;
            const duration = parseInt(durationSelect.value);
            const totalPrice = numberOfLots * lotPrice;
            const monthlyQuota = duration > 0 ? totalPrice / duration : 0;

            totalAmountDisplay.textContent = this.formatCurrency(totalPrice);
            calculatedQuotaDisplay.textContent = this.formatCurrency(monthlyQuota);
        };

        numberOfLotsInput.addEventListener('change', updateQuota);
        numberOfLotsInput.addEventListener('input', updateQuota);
        durationSelect.addEventListener('change', updateQuota);

        document.getElementById('editMemberForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.updateMember(memberId);
        });
    }

    updateMember(memberId) {
        const name = document.getElementById('editMemberName').value;
        const email = document.getElementById('editMemberEmail').value;
        const phone = document.getElementById('editMemberPhone').value;
        const numberOfLots = parseInt(document.getElementById('editMemberNumberOfLots').value) || 1;
        const paymentDuration = parseInt(document.getElementById('editPaymentDuration').value);

        const lotPrice = this.getUnitPrice();
        const totalPrice = numberOfLots * lotPrice;
        const monthlyQuota = totalPrice / paymentDuration;

        const memberIndex = this.members.findIndex(m => m.id === memberId);
        if (memberIndex !== -1) {
            this.members[memberIndex] = {
                ...this.members[memberIndex],
                name,
                email,
                phone,
                numberOfLots,
                paymentDuration,
                monthlyQuota
            };

            this.saveData();
            this.closeModal();
            this.updateUI();
            this.updateStats();
            this.showToast('Membre modifié avec succès!');
        }
    }

    editLot(lotId) {
        const lot = this.lots.find(l => l.id === lotId);
        if (!lot) return;

        const content = `
            <form id="editLotForm">
                <div class="form-group">
                    <label class="form-label">Nom du Lot</label>
                    <input type="text" class="form-input" id="editLotName" value="${lot.name}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Prix (FCFA)</label>
                    <input type="number" class="form-input" id="editLotPrice" value="${lot.price}" min="0" step="1" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Description</label>
                    <textarea class="form-input" id="editLotDescription" rows="3" required>${lot.description}</textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">Localisation</label>
                    <input type="text" class="form-input" id="editLotLocation" value="${lot.location}" required>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" onclick="app.closeModal()">Annuler</button>
                    <button type="submit" class="btn btn-primary">Modifier</button>
                </div>
            </form>
        `;

        this.showModal('Modifier le Lot', content);

        document.getElementById('editLotForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.updateLot(lotId);
        });
    }

    editLotPrice(lotId) {
        const lot = this.lots.find(l => l.id === lotId);
        if (!lot) return;

        const modal = document.getElementById('editLotPriceModal');
        document.getElementById('editLotName').value = lot.name;
        document.getElementById('editLotPrice').value = lot.price;
        document.getElementById('editLotPrice').focus();

        if (modal) {
            try { window._lastScrollY = window.scrollY || window.pageYOffset || 0; } catch (e) {}
            modal.classList.add('active');
            try { document.body.classList.add('modal-open'); } catch (e) {}
        }

        const saveBtn = document.getElementById('editLotPriceSaveBtn');
        const cancelBtn = document.getElementById('editLotPriceCancelBtn');
        const closeBtn = document.getElementById('editLotPriceClose');

        const cleanup = () => {
            if (modal) {
                modal.classList.remove('active');
                try { document.body.classList.remove('modal-open'); } catch (e) {}
                try { const y = window._lastScrollY || 0; window.scrollTo({ top: y, behavior: 'smooth' }); window._lastScrollY = null; } catch (e) {}
            }
            saveBtn.removeEventListener('click', handleSave);
            cancelBtn.removeEventListener('click', handleCancel);
            closeBtn.removeEventListener('click', handleCancel);
        };

        const handleSave = () => {
            const newPrice = parseFloat(document.getElementById('editLotPrice').value);
            if (isNaN(newPrice) || newPrice < 0) {
                this.showToast('Veuillez entrer un prix valide', 'error');
                return;
            }
            lot.price = newPrice;
            // Enregistrer le nouveau prix
            this.saveLots();

            // Recalculer les montants et quotas des membres en fonction du nouveau prix unitaire
            try {
                this.members = (this.members || []).map(member => {
                    const num = parseInt(member.numberOfLots) || 1;
                    const duration = parseInt(member.paymentDuration || member.duration) || 0;
                    const total = num * newPrice;
                    const monthly = duration > 0 ? Math.round((total / duration) / 100) * 100 : 0;
                    member.unitPrice = newPrice;
                    member.totalLotAmount = total;
                    member.monthlyQuota = monthly;
                    // garder la compatibilité des clés
                    member.duration = duration || member.duration;
                    return member;
                });
                this.saveMembers();
            } catch (err) {
                console.error('Erreur en recalculant les membres après changement de prix :', err);
            }

            this.renderLots();
            this.renderMembers();
            this.updateDashboard();
            this.showToast('Prix du lot mis à jour avec succès', 'success');
            cleanup();
        };

        const handleCancel = () => {
            cleanup();
        };

        saveBtn.addEventListener('click', handleSave);
        cancelBtn.addEventListener('click', handleCancel);
        closeBtn.addEventListener('click', handleCancel);
    }

    updateLot(lotId) {
        const name = document.getElementById('editLotName').value;
        const price = parseFloat(document.getElementById('editLotPrice').value);
        const description = document.getElementById('editLotDescription').value;
        const location = document.getElementById('editLotLocation').value;

        const lotIndex = this.lots.findIndex(l => l.id === lotId);
        if (lotIndex !== -1) {
            this.lots[lotIndex] = {
                ...this.lots[lotIndex],
                name,
                price,
                description,
                location
            };

            this.saveData();
            this.closeModal();
            this.updateUI();
            this.showToast('Lot modifié avec succès!');
        }
    }

    deleteMember(memberId) {
        const member = this.members.find(m => m.id === memberId);
        const memberName = member ? member.name : 'ce membre';

        this.showConfirmationModal(
            'Confirmer la suppression',
            `Êtes-vous sûr de vouloir supprimer ${memberName} ? Cette action supprimera aussi tous ses paiements et ne peut pas être annulée.`,
            () => {
                this.members = this.members.filter(m => m.id !== memberId);
                this.payments = this.payments.filter(p => p.memberId !== memberId);
                this.saveData();
                this.updateUI();
                this.updateStats();
                this.showToast('Membre supprimé avec succès');
            }
        );
    }

    deleteLot(lotId) {
        const lot = this.lots.find(l => l.id === lotId);
        const lotName = lot ? lot.name : 'ce lot';

        const membersWithLot = this.members.filter(member =>
            member.lots && member.lots.includes(lotId)
        );

        if (membersWithLot.length > 0) {
            this.showToast('Ce lot ne peut pas être supprimé car il est assigné à des membres', 'error');
            return;
        }

        this.showConfirmationModal(
            'Confirmer la suppression',
            `Êtes-vous sûr de vouloir supprimer ${lotName} ? Cette action ne peut pas être annulée.`,
            () => {
                this.lots = this.lots.filter(l => l.id !== lotId);
                this.saveData();
                this.updateUI();
                this.showToast('Lot supprimé avec succès');
            }
        );
    }

 getMonthlyPayments() {
    return this.payments.filter(payment => {
        const paymentDate = new Date(payment.date);
        return paymentDate.getMonth() === this.currentMonth &&
               paymentDate.getFullYear() === this.currentYear;
    });
}

getMonthlyTotal() {
    const monthlyPayments = this.getMonthlyPayments();
    return monthlyPayments.reduce((sum, payment) => sum + payment.amount, 0);
}

    populateFilters() {
        const monthFilter = document.getElementById('monthFilter');
        const monthNames = [
            'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
            'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
        ];

        monthNames.forEach((month, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = month;
            monthFilter.appendChild(option);
        });

        const memberFilter = document.getElementById('memberFilter');
        this.members.forEach(member => {
            const option = document.createElement('option');
            option.value = member.id;
            option.textContent = member.name;
            memberFilter.appendChild(option);
        });
    }

    exportToPDF() {
        const monthlyPayments = this.getMonthlyPayments();
        const totalCollected = monthlyPayments.reduce((sum, payment) => sum + payment.amount, 0);

        const content = `
            <h2>Rapport Mensuel - ${document.getElementById('currentMonth').textContent}</h2>
            <p><strong>Total collecté:</strong> ${this.formatCurrency(totalCollected)}</p>
            <p><strong>Nombre de paiements:</strong> ${monthlyPayments.length}</p>

            <h3>Détail des Paiements:</h3>
            <table border="1" style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Membre</th>
                        <th>Montant</th>
                    </tr>
                </thead>
                <tbody>
                    ${monthlyPayments.map(payment => {
                        const member = this.members.find(m => m.id === payment.memberId);
                        return `
                            <tr>
                                <td>${this.formatDate(payment.date)}</td>
                                <td>${member ? member.name : 'Membre Inconnu'}</td>
                                <td>${this.formatCurrency(payment.amount)}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;

        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <html>
                <head>
                    <title>Rapport Mensuel</title>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 20px; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background-color: #f2f2f2; }
                    </style>
                </head>
                <body>
                    ${content}
                </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
    }

    exportPaymentsToPDF() {
        const searchTerm = document.getElementById('paymentSearch').value.toLowerCase();
        const monthFilter = document.getElementById('monthFilter').value;
        const memberFilter = document.getElementById('memberFilter').value;
        const startMonthVal = (document.getElementById('paymentStartMonth') || {}).value;
        const endMonthVal = (document.getElementById('paymentEndMonth') || {}).value;

        let filteredPayments = this.payments;

        if (searchTerm) {
            filteredPayments = filteredPayments.filter(payment => {
                const member = this.members.find(m => m.id === payment.memberId);
                return member && member.name.toLowerCase().includes(searchTerm);
            });
        }

        if (monthFilter) {
            filteredPayments = filteredPayments.filter(payment => {
                if (payment.monthKey) {
                    return payment.monthKey === monthFilter;
                }
                const paymentDate = new Date(payment.date);
                return paymentDate.getMonth() === parseInt(monthFilter) &&
                       paymentDate.getFullYear() === this.currentYear;
            });
        }

        // Apply start/end month range to PDF export as well
        if (startMonthVal || endMonthVal) {
            let startDate = startMonthVal ? new Date(startMonthVal + '-01') : new Date('1970-01-01');
            let endDate = endMonthVal ? new Date(endMonthVal + '-01') : new Date('2999-12-31');
            endDate = new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0, 23,59,59,999);
            filteredPayments = filteredPayments.filter(payment => {
                const pd = new Date(payment.date);
                return pd >= startDate && pd <= endDate;
            });
        }

        if (memberFilter) {
            filteredPayments = filteredPayments.filter(payment =>
                payment.memberId === memberFilter
            );
        }

        filteredPayments.sort((a, b) => new Date(b.date) - new Date(a.date));

        const total = filteredPayments.reduce((sum, payment) => sum + payment.amount, 0);
        const now = new Date();
        
        // Générer le HTML du rapport
        const reportHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 950px; margin: 0 auto; padding: 30px;">
                <!-- En-tête -->
                <div style="text-align: center; margin-bottom: 30px; border-bottom: 3px solid #181818; padding-bottom: 20px;">
                    <h1 style="color: #181818; margin: 0; font-size: 28px;">CI Habitat</h1>
                    <p style="color: #5D6D7E; margin: 10px 0 0 0; font-size: 16px;">Grand Livre des Paiements</p>
                </div>

                <!-- Métadonnées du rapport -->
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 25px;">
                    <div style="background: #F8F9FA; padding: 15px; border-radius: 8px; border-left: 3px solid #3498DB;">
                        <div style="font-size: 12px; color: #5D6D7E; font-weight: 600;">Période</div>
                        <div style="font-size: 16px; font-weight: bold; color: #2C3E50; margin-top: 5px;">
                            ${monthFilter ? new Date(parseInt(monthFilter.split('-')[0]), parseInt(monthFilter.split('-')[1])).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : 'Tous les mois'}
                        </div>
                    </div>
                    <div style="background: #F0FFF4; padding: 15px; border-radius: 8px; border-left: 3px solid #27AE60;">
                        <div style="font-size: 12px; color: #5D6D7E; font-weight: 600;">Nombre de Paiements</div>
                        <div style="font-size: 16px; font-weight: bold; color: #27AE60; margin-top: 5px;">${filteredPayments.length}</div>
                    </div>
                    <div style="background: #FFF5E6; padding: 15px; border-radius: 8px; border-left: 3px solid #F39C12;">
                        <div style="font-size: 12px; color: #5D6D7E; font-weight: 600;">Total Collecté</div>
                        <div style="font-size: 16px; font-weight: bold; color: #F39C12; margin-top: 5px;">${this.formatCurrency(total)}</div>
                    </div>
                </div>

                <!-- Résumé Général -->
                <div style="background: #2C3E50; color: white; padding: 20px; border-radius: 10px; margin-bottom: 25px;">
                    <h3 style="margin: 0 0 15px 0; font-size: 18px;">Résumé Général</h3>
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;">
                        <div>
                            <div style="font-size: 12px; opacity: 0.95;">Montant Collecté</div>
                            <div style="font-size: 24px; font-weight: bold; margin-top: 5px;">${this.formatCurrency(total)}</div>
                        </div>
                        <div>
                            <div style="font-size: 12px; opacity: 0.95;">Nombre de Paiements</div>
                            <div style="font-size: 24px; font-weight: bold; margin-top: 5px;">${filteredPayments.length}</div>
                        </div>
                        <div>
                            <div style="font-size: 12px; opacity: 0.95;">Montant Moyen</div>
                            <div style="font-size: 24px; font-weight: bold; margin-top: 5px;">${this.formatCurrency(filteredPayments.length > 0 ? total / filteredPayments.length : 0)}</div>
                        </div>
                    </div>
                </div>

                <!-- Tableau des Paiements -->
                <div style="margin-bottom: 25px;">
                    <h3 style="color: #2C3E50; border-bottom: 2px solid #181818; padding-bottom: 10px; margin-bottom: 15px;">
                        <i class="fas fa-clipboard-list" style="margin-right:8px;color:#2C3E50"></i> Détail des Paiements
                    </h3>
                    ${filteredPayments.length > 0 ? `
                        <table style="width: 100%; border-collapse: collapse; background: white;">
                            <thead>
                                <tr style="background: #F8F9FA;">
                                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #E0E6ED; color: #2C3E50; font-weight: 600;">Date</th>
                                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #E0E6ED; color: #2C3E50; font-weight: 600;">Membre</th>
                                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #E0E6ED; color: #2C3E50; font-weight: 600;">Montant</th>
                                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #E0E6ED; color: #2C3E50; font-weight: 600;">Période</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${filteredPayments.map((payment, index) => {
                                    const member = this.members.find(m => m.id === payment.memberId);
                                    return `
                                        <tr style="border-bottom: 1px solid #E0E6ED; ${index % 2 === 0 ? 'background: #FAFBFC;' : ''}">
                                            <td style="padding: 12px;">${this.formatDate(payment.date)}</td>
                                            <td style="padding: 12px; font-weight: 500;">${member ? member.name : 'Membre Inconnu'}</td>
                                            <td style="padding: 12px; color: #27AE60; font-weight: 600;">${this.formatCurrency(payment.amount)}</td>
                                            <td style="padding: 12px; color: #5D6D7E;">${payment.month || 'N/A'}</td>
                                        </tr>
                                    `;
                                }).join('')}
                                <tr style="background: #F0F9FF; font-weight: bold;">
                                    <td colspan="2" style="padding: 12px; text-align: right; color: #2C3E50;">TOTAL</td>
                                    <td style="padding: 12px; color: #3498DB; font-size: 14px; border-top: 2px solid #3498DB;">${this.formatCurrency(total)}</td>
                                    <td style="padding: 12px;"></td>
                                </tr>
                            </tbody>
                        </table>
                    ` : '<div style="text-align: center; padding: 30px; color: #5D6D7E;">Aucun paiement à afficher selon les filtres sélectionnés</div>'}
                </div>

                <!-- Analyse par Membre -->
                ${filteredPayments.length > 0 ? `
                    <div style="margin-bottom: 25px;">
                        <h3 style="color: #2C3E50; border-bottom: 2px solid #181818; padding-bottom: 10px; margin-bottom: 15px;">
                            <i class="fas fa-users" style="margin-right:8px;color:#2C3E50"></i> Résumé par Membre
                        </h3>
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr style="background: #F8F9FA;">
                                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #E0E6ED; color: #2C3E50; font-weight: 600;">Membre</th>
                                    <th style="padding: 12px; text-align: center; border-bottom: 2px solid #E0E6ED; color: #2C3E50; font-weight: 600;">Paiements</th>
                                    <th style="padding: 12px; text-align: right; border-bottom: 2px solid #E0E6ED; color: #2C3E50; font-weight: 600;">Total Collecté</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${[...new Map(filteredPayments.map(p => [p.memberId, p])).keys()].map(memberId => {
                                    const member = this.members.find(m => m.id === memberId);
                                    const memberPayments = filteredPayments.filter(p => p.memberId === memberId);
                                    const memberTotal = memberPayments.reduce((sum, p) => sum + p.amount, 0);
                                    return `
                                        <tr style="border-bottom: 1px solid #E0E6ED;">
                                            <td style="padding: 12px; font-weight: 500;">${member ? member.name : 'Membre Inconnu'}</td>
                                            <td style="padding: 12px; text-align: center; color: #3498DB;">${memberPayments.length}</td>
                                            <td style="padding: 12px; text-align: right; color: #27AE60; font-weight: 600;">${this.formatCurrency(memberTotal)}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : ''}

                <!-- Pied de page -->
                <div style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #E0E6ED; text-align: center; color: #5D6D7E; font-size: 12px;">
                    <p style="margin: 5px 0;"><i class="fas fa-phone" style="margin-right:6px;color:#5D6D7E"></i> Contact: 01 618 837 90</p>
                    <p style="margin: 5px 0;">Document généré le ${now.toLocaleDateString('fr-FR')} à ${now.toLocaleTimeString('fr-FR')}</p>
                    <p style="margin: 15px 0 0 0; font-weight: bold; color: #181818;">CI Habitat - L'immobilier Autrement</p>
                </div>
            </div>
        `;

        const reportContainer = document.createElement('div');
        reportContainer.innerHTML = reportHtml;
        reportContainer.style.position = 'absolute';
        reportContainer.style.left = '-9999px';
        document.body.appendChild(reportContainer);

        // Générer le PDF
        html2canvas(reportContainer, {
            scale: 2,
            backgroundColor: '#ffffff',
            logging: false
        }).then(canvas => {
            document.body.removeChild(reportContainer);
            
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const imgData = canvas.toDataURL('image/png');
            const imgWidth = 210;
            const pageHeight = 295;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;
            let heightLeft = imgHeight;
            let position = 0;
            
            pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;
            
            while (heightLeft >= 0) {
                position = heightLeft - imgHeight;
                pdf.addPage();
                pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;
            }
            
            const fileName = `Grand_Livre_Paiements_${now.toISOString().split('T')[0]}.pdf`;
            pdf.save(fileName);
            
            this.showNotification('Grand livre PDF généré avec succès !', 'success');
        }).catch(error => {
            console.error('Erreur génération PDF:', error);
            document.body.removeChild(reportContainer);
            this.showNotification('Erreur lors de la génération du PDF', 'error');
        });
    }

    populateMonthFilters() {
        const monthFilter = document.getElementById('monthFilter');
        const currentYear = new Date().getFullYear();
        const monthNames = [
            'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
            'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
        ];

        monthFilter.innerHTML = '<option value="">Tous les Mois</option>';

        for (let i = 0; i < 12; i++) {
            const monthKey = `${currentYear}-${i}`;
            const option = document.createElement('option');
            option.value = monthKey;
            option.textContent = `${monthNames[i]} ${currentYear}`;
            monthFilter.appendChild(option);
        }
    }

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    formatCurrency(amount) {
        const numericAmount = Number(amount);
        const rounded = Number.isFinite(numericAmount) ? Math.round(numericAmount) : 0;

        return new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: 'XOF',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(rounded).replace('XOF', 'FCFA');
    }

    formatDate(dateString) {
        return new Date(dateString).toLocaleDateString('fr-FR');
    }

    showBulkAddMembersModal() {
        const content = `
            <div style="max-width:720px;padding:16px;">
                <div style="margin-bottom:8px;">
                    <label style="font-weight:600;display:block;margin-bottom:6px;">Importer fichier Excel/CSV</label>
                    <input type="file" id="bulkMembersFile" accept=".csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" style="display:block;" />
                </div>
                <p style="margin:0 0 8px; font-weight:700;">Importer des Membres (CSV)</p>
                <textarea id="bulkMembersCsv" placeholder="Claudia Kodjane ,2" style="width:100%;height:200px;padding:8px;border:1px solid #ddd;border-radius:6px;"></textarea>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
                    <button class="btn btn-secondary" onclick="app.closeModal()">Annuler</button>
                    <button class="btn btn-outline" id="previewImportBtn" style="background:#fff;border:1px solid #ccc;color:#333;">Prévisualiser</button>
                    <button class="btn btn-primary" id="importMembersBtn">Importer</button>
                </div>
                <div id="bulkImportPreview" style="margin-top:12px;max-height:320px;overflow:auto;border:1px solid #eee;padding:8px;border-radius:6px;background:#fff;display:none;"></div>
            </div>
        `;

        this.showModal('Importer Membres en Masse', content);

        // Support Excel/CSV file import: parse first sheet to CSV and populate textarea for preview
        const fileInput = document.getElementById('bulkMembersFile');
        if (fileInput) {
            fileInput.addEventListener('change', (ev) => {
                const f = ev.target.files && ev.target.files[0];
                if (!f) return;
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const data = e.target.result;
                        // XLSX is loaded via CDN in index.html
                        const wb = XLSX.read(data, { type: 'array' });
                        const firstName = wb.SheetNames && wb.SheetNames[0];
                        if (!firstName) { this.showToast('Fichier vide', 'error'); return; }
                        const sheet = wb.Sheets[firstName];
                        const csv = XLSX.utils.sheet_to_csv(sheet);
                        const ta = document.getElementById('bulkMembersCsv');
                        if (ta) ta.value = csv;
                        this.showToast('Feuille chargée pour prévisualisation', 'success');
                    } catch (err) {
                        console.error('Erreur lecture fichier import:', err);
                        this.showToast('Impossible de lire le fichier', 'error');
                    }
                };
                reader.readAsArrayBuffer(f);
            });
        }

        const importBtn = document.getElementById('importMembersBtn');
        const previewBtn = document.getElementById('previewImportBtn');
        const previewContainer = document.getElementById('bulkImportPreview');
        const renderPreview = () => {
            const txt = document.getElementById('bulkMembersCsv').value || '';
            const lines = txt.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length === 0) { this.showToast('Aucune donnée pour prévisualiser', 'error'); return; }

            let headers = lines[0].split(',').map(h => h.trim());
            let rows = lines.slice(1);
            const known = ['name','email','phone','numberoflots','startdate','paymentduration','duration','lots','nom','fullname','start'];
            if (!headers.map(h=>h.toLowerCase()).includes('name') && headers.every(h => !known.includes(h.toLowerCase()))) {
                // guess format: check if first line looks like data 'name,number'
                const firstCols = lines[0].split(',').map(c => c.trim());
                const secondIsNum = firstCols.length >= 2 && /^\s*-?\d+(?:[.,]\d+)?\s*$/.test(firstCols[1]);
                const firstIsName = firstCols.length >= 1 && /[a-zA-Zéèàçùâêîôûëïüœ'-]/.test(firstCols[0]);
                if (firstCols.length >= 2 && firstIsName && secondIsNum) {
                    headers = ['name','numberOfLots'];
                    rows = lines.slice(0);
                } else {
                    // treat as single-name-per-line
                    headers = ['name'];
                    rows = lines.slice(0);
                }
            }

            const maxRows = 200;
            const table = document.createElement('table');
            table.style.width = '100%';
            table.style.borderCollapse = 'collapse';
            const thead = document.createElement('thead');
            const thr = document.createElement('tr');
            headers.forEach(h => {
                const th = document.createElement('th');
                th.textContent = h;
                th.style.borderBottom = '1px solid #ddd';
                th.style.padding = '6px';
                th.style.textAlign = 'left';
                thr.appendChild(th);
            });
            thead.appendChild(thr);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            rows.slice(0, maxRows).forEach(r => {
                const tr = document.createElement('tr');
                const cols = r.split(',').map(c => c.trim());
                for (let i=0;i<headers.length;i++) {
                    const td = document.createElement('td');
                    td.textContent = cols[i] || '';
                    td.style.padding = '6px';
                    td.style.borderBottom = '1px solid #f1f1f1';
                    tr.appendChild(td);
                }
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);

            if (previewContainer) {
                previewContainer.innerHTML = '';
                previewContainer.appendChild(table);
                previewContainer.style.display = 'block';
                if (rows.length > maxRows) {
                    const more = document.createElement('div');
                    more.style.marginTop = '8px';
                    more.style.fontSize = '0.9em';
                    more.style.color = '#666';
                    more.textContent = `Affichage ${maxRows} premières lignes sur ${rows.length}`;
                    previewContainer.appendChild(more);
                }
                previewContainer.scrollIntoView({ behavior: 'smooth' });
            }
        };

        if (previewBtn) {
            previewBtn.addEventListener('click', () => renderPreview());
        }
        if (importBtn) {
            importBtn.addEventListener('click', () => {
                const txt = document.getElementById('bulkMembersCsv').value || '';
                const lines = txt.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
                if (lines.length === 0) { this.showToast('Aucune donnée fournie', 'error'); return; }

                let headers = lines[0].split(',').map(h => h.trim().toLowerCase());
                let rows = lines.slice(1);

                // If input appears to be a simple list or a two-column list (name,numberOfLots) without headers,
                // detect and adapt: prefer ['name','numberOfLots'] when second column looks numeric.
                const known = ['name','email','phone','numberoflots','startdate','paymentduration','duration','lots','nom','fullname','start'];
                if (!headers.includes('name') && headers.every(h => !known.includes(h))) {
                    // inspect first line cells to guess format
                    const firstCols = lines[0].split(',').map(c => c.trim());
                    const secondLooksNumeric = firstCols.length >= 2 && /^\s*-?\d+(?:[.,]\d+)?\s*$/.test(firstCols[1]);
                    const firstLooksLikeName = firstCols.length >= 1 && /[a-zA-Zéèàçùâêîôûëïüœ'-]/.test(firstCols[0]);
                    if (firstCols.length >= 2 && firstLooksLikeName && secondLooksNumeric) {
                        headers = ['name', 'numberOfLots'];
                        rows = lines.slice(0); // include first line as data
                    } else {
                        // preserve all lines as rows and use 'name' as header
                        rows = lines.slice(0); // include first line
                        headers = ['name'];
                    }
                }
                const created = [];
                // Normalize headers to lowercase keys so later lookups like 'numberoflots' work
                headers = headers.map(h => String(h).trim().toLowerCase());
                const errors = [];

                // Detect payment-month headers mapping (e.g. "juil 2025", "juillet 2025", "juin 2026")
                const monthNamesMap = {
                    'jan':1,'janv':1,'janvier':1,
                    'fev':2,'février':2,'fevrier':2,'fév':2,
                    'mar':3,'mars':3,
                    'avr':4,'avril':4,
                    'mai':5,
                    'jun':6,'juin':6,
                    'jul':7,'juil':7,'juillet':7,
                    'aug':8,'aou':8,'aoû':8,'août':8,'aout':8,
                    'sep':9,'sept':9,'septembre':9,
                    'oct':10,'octobre':10,
                    'nov':11,'novembre':11,
                    'dec':12,'déc':12,'decembre':12,'décembre':12
                };

                // Define allowed period: July 2025 -> June 2026
                const allowedMonthKeys = [];
                for (let y=2025; y<=2026; y++) {
                    const startM = (y===2025)?7:1;
                    const endM = (y===2026)?6:12;
                    for (let m=startM; m<=endM; m++) {
                        allowedMonthKeys.push(`${y}-${String(m).padStart(2,'0')}`);
                    }
                }

                const paymentHeaderMap = {}; // index -> monthKey
                headers.forEach((h, idx) => {
                    // try to find month name and year in header text
                    const parts = h.replace(/[-_.]/g, ' ').split(/\s+/).filter(Boolean);
                    let foundMonth = null; let foundYear = null;
                    parts.forEach(p => {
                        const clean = p.replace(/[^a-z0-9éèêàôûç]/g,'');
                        if (!foundMonth) {
                            const key = Object.keys(monthNamesMap).find(k => clean.includes(k));
                            if (key) foundMonth = monthNamesMap[key];
                        }
                        if (!foundYear) {
                            const yMatch = p.match(/(20\d{2}|\b\d{2}\b)/);
                            if (yMatch) {
                                let yy = yMatch[0];
                                if (yy.length === 2) yy = (yy.length===2 ? '20'+yy : yy);
                                foundYear = parseInt(yy,10);
                            }
                        }
                    });
                    if (foundMonth && foundYear) {
                        const mk = `${foundYear}-${String(foundMonth).padStart(2,'0')}`;
                        if (allowedMonthKeys.includes(mk)) {
                            paymentHeaderMap[idx] = mk;
                        }
                    }
                });

                rows.forEach((r, idx) => {
                    const cols = r.split(',').map(c => c.trim());
                    const obj = {};
                    headers.forEach((h, i) => { obj[h] = cols[i] || ''; });

                    const name = obj.name || obj.nom || obj.fullname || '';
                    if (!name) {
                        errors.push(`Ligne ${idx+2}: nom manquant`);
                        return;
                    }

                    const email = obj.email || '';
                    const phone = obj.phone || '';
                    const numberOfLots = parseInt(obj.numberoflots || obj.lots || '1', 10) || 1;
                    let paymentDuration = parseInt(obj.paymentduration || obj.duration || '12', 10) || 12;
                    let startDate = obj.startdate || obj.start || '2025-07-01';

                    // Detect explicit French month-range like "juil 25,..,juin 2026" anywhere in the row
                    const rowText = Object.values(obj).join(' ').toLowerCase();
                    const hasJuil = /jui[lLé]t?|juil/.test(rowText);
                    const hasJuin = /juin/.test(rowText);
                    const has25 = /(?:\b25\b|2025)/.test(rowText);
                    const has26 = /(?:\b26\b|2026)/.test(rowText);
                    if (hasJuil && hasJuin && (has25 || has26)) {
                        // Force period July 2025 -> June 2026
                        startDate = '2025-07-01';
                        paymentDuration = 12;
                    }

                    const unitPrice = this.getUnitPrice();
                    const totalLotAmount = numberOfLots * unitPrice;
                    const monthlyQuota = paymentDuration > 0 ? Math.round((totalLotAmount / paymentDuration) / 100) * 100 : 0;

                    const member = {
                        id: this.generateId(),
                        name: name,
                        email: email,
                        phone: phone,
                        numberOfLots: numberOfLots,
                        paymentDuration: paymentDuration,
                        duration: paymentDuration,
                        unitPrice: unitPrice,
                        totalLotAmount: totalLotAmount,
                        monthlyQuota: monthlyQuota,
                        startDate: new Date(startDate).toISOString(),
                        endDate: (function(sd, dur){ const d = new Date(sd); d.setMonth(d.getMonth()+dur); d.setDate(d.getDate()-1); return d.toISOString(); })(startDate, paymentDuration),
                        createdAt: new Date().toISOString()
                    };

                    // Create payments for any monthly columns matching Jul 2025 -> Jun 2026
                    const paymentsCreated = [];
                    Object.keys(paymentHeaderMap).forEach(colIdx => {
                        const mk = paymentHeaderMap[colIdx];
                        const val = cols[colIdx] ? cols[colIdx].replace(/[^0-9.,-]/g, '').replace(',', '.') : '';
                        const num = parseFloat(val);
                        if (!isNaN(num) && num > 0) {
                            const [y, m] = mk.split('-');
                            const dateIso = new Date(parseInt(y,10), parseInt(m,10)-1, 1).toISOString();
                            const pay = {
                                id: this.generateId(),
                                memberId: member.id,
                                amount: Math.round(num),
                                date: dateIso,
                                monthKey: mk,
                                createdAt: new Date().toISOString()
                            };
                            paymentsCreated.push(pay);
                        }
                    });


                    this.members.push(member);
                    created.push(member);

                    // Attach created payments to global payments array
                    if (paymentsCreated && paymentsCreated.length > 0) {
                        this.payments = this.payments || [];
                        this.payments.push(...paymentsCreated);
                    }
                });

                if (created.length > 0) {
                    this.saveData();
                    this.closeModal();
                    if (typeof this.renderMembers === 'function') this.renderMembers();
                    if (typeof this.updateStats === 'function') this.updateStats();
                    this.showToast(`${created.length} membres importés avec succès`);
                }
                if (errors.length > 0) {
                    console.warn('Erreurs import:', errors);
                    this.showToast(`${errors.length} erreurs lors de l'import (voir console)`, 'error');
                }
            });
        }
    }

    saveData() {
        this.saveMembers();
this.savePayments();
this.saveLots();
    }

    showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;

        const container = document.getElementById('toastContainer');
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('show');
        }, 100);

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                container.removeChild(toast);
            }, 300);
        }, 3000);
    }

    showConfirmationModal(title, message, onConfirm) {
        const modalContent = `
            <div class="confirmation-modal">
                <div class="confirmation-message">
                    <p>${message}</p>
                </div>
                <div class="confirmation-actions">
                    <button class="btn btn-secondary" onclick="paymentManager.closeModal()">Annuler</button>
                    <button class="btn btn-danger" id="confirmAction">Confirmer</button>
                </div>
            </div>
        `;

        this.showModal(title, modalContent);

        setTimeout(() => {
            const confirmBtn = document.getElementById('confirmAction');
            if (confirmBtn) {
                confirmBtn.addEventListener('click', () => {
                    onConfirm();
                    this.closeModal();
                });
            }
        }, 100);
    }

    updateStatistics() {
        this.setupStatsFilters();
        this.updateStatisticsOverview();
        this.updateMonthlyChart();
        this.updatePerformanceTable();
    }

    setupStatsFilters() {
        if (this._statsFilterInitialized) return;
        this._statsFilterInitialized = true;
        const startEl = document.getElementById('statsStartDate');
        const endEl = document.getElementById('statsEndDate');
        const applyBtn = document.getElementById('applyStatsFilter');
        const now = new Date();
        // Default start to July 2025 as requested
        if (startEl && !startEl.value) startEl.value = '2025-07';
        if (endEl && !endEl.value) endEl.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        if (applyBtn) applyBtn.addEventListener('click', () => {
            this.updateStatisticsOverview();
            this.updateMonthlyChart();
            this.updatePerformanceTable();
        });
    }

    populateYearFilter() {
        const yearFilter = document.getElementById('statsYearFilter');
        const currentYear = new Date().getFullYear();

        yearFilter.innerHTML = '<option value="">Toutes les années</option>';

        const years = new Set();
        
        // Ajouter les années des paiements
        this.payments.forEach(payment => {
            const year = new Date(payment.date).getFullYear();
            years.add(year);
        });

        // Ajouter les années des membres
        this.members.forEach(member => {
            const year = new Date(member.createdAt || new Date()).getFullYear();
            years.add(year);
        });

        years.add(currentYear);

        Array.from(years).sort().reverse().forEach(year => {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            yearFilter.appendChild(option);
        });
    }

    updateStatisticsOverview() {
        const startVal = document.getElementById('statsStartDate') ? document.getElementById('statsStartDate').value : null;
        const endVal = document.getElementById('statsEndDate') ? document.getElementById('statsEndDate').value : null;
        let filteredPayments = this.payments;
        let filteredMembers = this.members;

        let startDate = null;
        let endDate = null;
        if (startVal) startDate = new Date(startVal + '-01');
        if (endVal) {
            const tmp = new Date(endVal + '-01');
            endDate = new Date(tmp.getFullYear(), tmp.getMonth() + 1, 0); // last day of month
        }

        if (startDate && endDate) {
            filteredPayments = this.payments.filter(payment => {
                const d = new Date(payment.date);
                return d >= startDate && d <= endDate;
            });
            filteredMembers = this.members.filter(member => {
                const d = new Date(member.createdAt || new Date());
                return d >= startDate && d <= endDate;
            });
        }

        const totalPayments = filteredPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
        const totalExpected = filteredMembers.reduce((sum, m) => sum + ((m.monthlyQuota || 0) * (m.paymentDuration || 12)), 0);
        const completionRate = totalExpected > 0 ? Math.round((totalPayments / totalExpected) * 100) : 0;

        document.getElementById('totalMembersStats').textContent = filteredMembers.length;
        document.getElementById('totalPaymentsStats').textContent = this.formatCurrency(totalPayments);
        document.getElementById('totalLotsStats').textContent = this.lots.length;
        document.getElementById('completionRateStats').textContent = `${completionRate}%`;
    }

    updateMonthlyChart() {
        const startVal = document.getElementById('statsStartDate') ? document.getElementById('statsStartDate').value : null;
        const endVal = document.getElementById('statsEndDate') ? document.getElementById('statsEndDate').value : null;
        const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

        const chartContainer = document.getElementById('monthlyChart');
        chartContainer.innerHTML = '';

        // build months range
        let months = [];
        if (startVal && endVal) {
            let cur = new Date(startVal + '-01');
            const endDate = new Date(endVal + '-01');
            while (cur <= endDate) {
                months.push({ year: cur.getFullYear(), month: cur.getMonth() });
                cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
            }
        } else {
            // default: current year full 12 months
            const y = new Date().getFullYear();
            for (let m = 0; m < 12; m++) months.push({ year: y, month: m });
        }

        // initialize monthly data map keyed by YYYY-MM
        const monthlyData = {};
        months.forEach(m => {
            const key = `${m.year}-${String(m.month+1).padStart(2,'0')}`;
            monthlyData[key] = { payments: 0, amount: 0, newMembers: 0, label: `${monthNames[m.month]} ${m.year}` };
        });

        this.payments.forEach(payment => {
            const paymentDate = new Date(payment.date);
            const key = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth()+1).padStart(2,'0')}`;
            if (monthlyData[key]) {
                monthlyData[key].payments++;
                monthlyData[key].amount += payment.amount || 0;
            }
        });

        this.members.forEach(member => {
            const memberDate = new Date(member.createdAt || new Date());
            const key = `${memberDate.getFullYear()}-${String(memberDate.getMonth()+1).padStart(2,'0')}`;
            if (monthlyData[key]) monthlyData[key].newMembers++;
        });

        const values = Object.values(monthlyData);
        const maxPayments = Math.max(...values.map(m => m.payments), 0);
        const maxMembers = Math.max(...values.map(m => m.newMembers), 0);
        const maxValue = Math.max(maxPayments, maxMembers, 1);

        values.forEach(data => {
            const paymentHeight = maxValue > 0 ? (data.payments / maxValue) * 180 : 0;
            const memberHeight = maxValue > 0 ? (data.newMembers / maxValue) * 180 : 0;

            const barContainer = document.createElement('div');
            barContainer.className = 'chart-bar';
            barContainer.innerHTML = `
                <div class="chart-bar-container">
                    <div class="chart-bar-fill" style="height: ${paymentHeight}px;" title="Paiements: ${data.payments}"></div>
                </div>
                <div class="chart-bar-container">
                    <div class="chart-bar-fill secondary" style="height: ${memberHeight}px;" title="Nouveaux membres: ${data.newMembers}"></div>
                </div>
                <div class="chart-bar-label">${data.label}</div>
            `;
            chartContainer.appendChild(barContainer);
        });
    }

formatCurrencyForPDF(amount) {
    if (!amount || isNaN(amount)) return '0 FCFA';
    const formattedNumber = Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return formattedNumber + ' FCFA';
}

getIconDataURL(iconClass, color = '#2C3E50', size = 16) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = size;
    canvas.height = size;

    const tempIcon = document.createElement('i');
    tempIcon.className = iconClass;
    tempIcon.style.fontSize = size + 'px';
    tempIcon.style.color = color;
    document.body.appendChild(tempIcon);

    const iconUnicode = window.getComputedStyle(tempIcon, '::before').content;
    ctx.font = `${size}px "Font Awesome 6 Free"`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(iconUnicode.replace(/['"]/g, ''), size/2, size/2);

    document.body.removeChild(tempIcon);
    return canvas.toDataURL();
}

    updatePerformanceTable() {
        const startVal = document.getElementById('statsStartDate') ? document.getElementById('statsStartDate').value : null;
        const endVal = document.getElementById('statsEndDate') ? document.getElementById('statsEndDate').value : null;
        const selectedYear = null; // unused when range is set below
        const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

        const tableBody = document.getElementById('performanceTableBody');
        tableBody.innerHTML = '';

        // build months range (default current year)
        let months = [];
        if (startVal && endVal) {
            let cur = new Date(startVal + '-01');
            const endDate = new Date(endVal + '-01');
            while (cur <= endDate) {
                months.push({ year: cur.getFullYear(), month: cur.getMonth() });
                cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
            }
        } else {
            const y = new Date().getFullYear();
            for (let m = 0; m < 12; m++) months.push({ year: y, month: m });
        }

        const monthlyData = {};
        months.forEach(m => monthlyData[m.month] = { payments: 0, amount: 0, newMembers: 0, label: `${m.month+1}/${m.year}` });

        this.payments.forEach(payment => {
            const paymentDate = new Date(payment.date);
            months.forEach((m, idx) => {
                if (paymentDate.getFullYear() === m.year && paymentDate.getMonth() === m.month) {
                    monthlyData[m.month].payments++;
                    monthlyData[m.month].amount += payment.amount || 0;
                }
            });
        });

        this.members.forEach(member => {
            const memberDate = new Date(member.createdAt || new Date());
            months.forEach(m => {
                if (memberDate.getFullYear() === m.year && memberDate.getMonth() === m.month) {
                    monthlyData[m.month].newMembers++;
                }
            });
        });

        for (let i = 0; i < months.length; i++) {
            const m = months[i];
            const data = monthlyData[m.month];
            const completionRate = this.members.length > 0 ? Math.round((data.payments / this.members.length) * 100) : 0;

            let performanceBadge = '';
            if (completionRate >= 80) {
                performanceBadge = '<span class="performance-badge excellent">Excellent</span>';
            } else if (completionRate >= 60) {
                performanceBadge = '<span class="performance-badge good">Bon</span>';
            } else {
                performanceBadge = '<span class="performance-badge average">Moyen</span>';
            }

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${monthNames[m.month]}</td>
                <td>${data.payments}</td>
                <td>${this.formatCurrency(data.amount)}</td>
                <td>${data.newMembers}</td>
                <td>${performanceBadge}</td>
            `;
            tableBody.appendChild(row);
        }
    }

    exportStatist() {
        const startVal = document.getElementById('statsStartDate') ? document.getElementById('statsStartDate').value : null;
        const endVal = document.getElementById('statsEndDate') ? document.getElementById('statsEndDate').value : null;
        const label = startVal && endVal ? `${startVal} → ${endVal}` : 'période sélectionnée';
        this.showToast(`Export des statistiques ${label} terminé!`, 'success');
    }

printReceipt(paymentId) {
    const payment = this.payments.find(p => p.id === paymentId) || (typeof paymentId === 'string' ? this.payments.find(p => p.id === paymentId) : null);
    if (!payment) { this.showToast('Paiement introuvable', 'error'); return; }
    const member = this.members.find(m => m.id === payment.memberId);

    this.generatePaymentReceipt(payment, member);
}
}

/* ---------- Mobile menu toggle (ajouter à la fin de script.js) ---------- */
(function(){
  const mobileBtn = document.getElementById('mobileMenuBtn');
  if(!mobileBtn) return;

  // créer overlay DOM (si pas présent)
  let overlay = document.querySelector('.mobile-nav-overlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.className = 'mobile-nav-overlay';
    overlay.innerHTML = `
      <div class="mobile-nav-panel" role="dialog" aria-modal="true">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="font-size:16px">Menu</strong>
          <button id="mobileMenuClose" style="border:none;background:transparent;font-size:20px;cursor:pointer">✕</button>
        </div>
        <div class="mobile-nav-list">
          ${Array.from(document.querySelectorAll('.header-nav .nav-tab')).map(btn=>{
            const label = btn.textContent.trim();
            const tab = btn.getAttribute('data-tab') || '';
            return `<button class="nav-tab" data-tab="${tab}">${btn.innerHTML}</button>`;
          }).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  const panel = overlay.querySelector('.mobile-nav-panel');
  const closeBtn = document.getElementById('mobileMenuClose');

  function openMobileMenu(){
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
  }
  function closeMobileMenu(){
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
  }

  mobileBtn.addEventListener('click', openMobileMenu);
  closeBtn && closeBtn.addEventListener('click', closeMobileMenu);
  overlay.addEventListener('click', (e)=>{
    if(e.target === overlay) closeMobileMenu();
  });

  // when user clicks any nav inside overlay -> switch tab (reuse existing handlers)
  overlay.addEventListener('click', (e)=>{
    const t = e.target.closest('.nav-tab');
    if(!t) return;
    const tabName = t.getAttribute('data-tab');
    if(tabName){
      // simulate click on desktop nav-tab counterpart (so existing logic runs)
      const desktop = document.querySelector('.header-nav .nav-tab[data-tab="'+tabName+'"]');
      if(desktop) desktop.click();
    }
    closeMobileMenu();
  });

  // bottom nav syncing
  const bottomBtns = document.querySelectorAll('.bottom-nav .nav-tab');
  bottomBtns.forEach(b=>{
    b.addEventListener('click', ()=>{
      const tab = b.getAttribute('data-tab');
      // trigger desktop nav button
      const desktop = document.querySelector('.header-nav .nav-tab[data-tab="'+tab+'"]');
      if(desktop) desktop.click();
      // update active styles
      document.querySelectorAll('.bottom-nav .nav-tab').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      // ensure we close mobile panel if open
      const ov = document.querySelector('.mobile-nav-overlay');
      if(ov && ov.style.display === 'flex') ov.style.display = 'none';
    });
  });

  // close overlay when content changed by your existing tab logic (optional)
  // si tu as un event dispatcher lors du changement d'onglet, lier ici:
  // document.addEventListener('app:tabChange', closeMobileMenu);

})();

// ===============================================
// NOUVELLES FONCTIONNALITÉS AMÉLIORÉES
// ===============================================

// Variables globales pour les graphiques
let paymentsChart = null;

// Fonction pour initialiser les graphiques
function initializeCharts() {
    if (!window.paymentManager) return;
    
    // Graphique d'évolution des paiements
    const paymentsCtx = document.getElementById('paymentsChart');
    if (paymentsCtx) {
        const startInput = document.getElementById('chartStartDate');
        const endInput = document.getElementById('chartEndDate');
        
        let startDate = null;
        let endDate = null;
        
        if (startInput?.value && endInput?.value) {
            const [startYear, startMonth] = startInput.value.split('-').map(Number);
            const [endYear, endMonth] = endInput.value.split('-').map(Number);
            startDate = new Date(startYear, startMonth - 1, 1);
            endDate = new Date(endYear, endMonth - 1, 1);
        }
        
        const monthsData = getPaymentsChartData(startDate, endDate);
        
        if (paymentsChart) paymentsChart.destroy();
        
        paymentsChart = new Chart(paymentsCtx, {
            type: 'line',
            data: {
                labels: monthsData.labels,
                datasets: [{
                    label: 'Paiements Collectés',
                    data: monthsData.amounts,
                    borderColor: '#181818',
                    backgroundColor: 'rgba(24,24,24,0.06)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointBackgroundColor: '#181818',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            padding: 15,
                            font: { size: 13, weight: '600' }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(44, 62, 80, 0.95)',
                        padding: 12,
                        titleFont: { size: 14, weight: '600' },
                        bodyFont: { size: 13 },
                        callbacks: {
                            label: function(context) {
                                return 'Montant: ' + formatCurrency(context.parsed.y);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return formatCurrency(value);
                            }
                        },
                        grid: { color: 'rgba(0, 0, 0, 0.05)' }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        });
    }
    
    updateTopContributors();
}

// Récupérer les données pour le graphique des paiements
function getPaymentsChartData(startDate = null, endDate = null) {
    const data = { labels: [], amounts: [] };
    const now = new Date();
    
    // Si pas de dates spécifiées, utiliser les 12 derniers mois
    if (!startDate || !endDate) {
        endDate = new Date(now.getFullYear(), now.getMonth(), 1);
        startDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    }
    
    // Calculer le nombre de mois entre début et fin
    const monthsDiff = (endDate.getFullYear() - startDate.getFullYear()) * 12 + 
                       (endDate.getMonth() - startDate.getMonth()) + 1;
    
    // Limiter à 12 mois maximum
    const months = Math.min(monthsDiff, 12);
    
    for (let i = 0; i < months; i++) {
        const date = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
        const monthName = date.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
        data.labels.push(monthName);
        
        // Créer le monthKey pour ce mois (format: "YYYY-M" ou "YYYY-MM")
        const targetMonthKey1 = `${date.getFullYear()}-${date.getMonth()}`;
        const targetMonthKey2 = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        const monthPayments = window.paymentManager.payments.filter(p => {
            // Utiliser monthKey si disponible, sinon fallback sur la date
            if (p.monthKey) {
                return p.monthKey === targetMonthKey1 || p.monthKey === targetMonthKey2;
            } else {
                // Fallback pour les anciens paiements sans monthKey
                const paymentDate = new Date(p.date);
                return paymentDate.getMonth() === date.getMonth() && 
                       paymentDate.getFullYear() === date.getFullYear();
            }
        });
        
        const total = monthPayments.reduce((sum, p) => sum + p.amount, 0);
        data.amounts.push(total);
    }
    
    return data;
}

// Mettre à jour le top des contributeurs
function updateTopContributors() {
    const container = document.getElementById('topContributorsList');
    if (!container) return;
    
    const contributorsData = window.paymentManager.members.map(member => {
        const memberPayments = window.paymentManager.payments.filter(p => p.memberId === member.id);
        const total = memberPayments.reduce((sum, p) => sum + p.amount, 0);
        return { member, total };
    }).filter(c => c.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
    
    if (contributorsData.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#5D6D7E;padding:20px;">Aucun contributeur pour le moment</p>';
        return;
    }
    
    container.innerHTML = contributorsData.map((data, index) => {
        const rankClass = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
        const initials = data.member.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        
        return `
            <div class="contributor-item">
                <div class="contributor-rank ${rankClass}">${index + 1}</div>
                <div class="contributor-avatar">${initials}</div>
                <div class="contributor-info">
                    <div class="contributor-name">${data.member.name}</div>
                    <div class="contributor-stats">${data.member.phone || 'N/A'}</div>
                </div>
                <div class="contributor-amount">${formatCurrency(data.total)}</div>
            </div>
        `;
    }).join('');
}

// Afficher les alertes pour les paiements en retard
function updateAlerts() {
    const alertsCard = document.getElementById('alertsCard');
    const alertsList = document.getElementById('alertsList');
    
    if (!alertsCard || !alertsList) return;
    
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    // Membres impayés ce mois
    const unpaidMembers = window.paymentManager.members.filter(member => {
        const memberPayments = window.paymentManager.payments.filter(p => {
            const paymentDate = new Date(p.date);
            return p.memberId === member.id &&
                   paymentDate.getMonth() === currentMonth &&
                   paymentDate.getFullYear() === currentYear;
        });
        return memberPayments.length === 0;
    });
    
    // Membres dont l'échéance approche ou est dépassée
    const endingSoonMembers = window.paymentManager.members.filter(member => {
        if (!member.endDate) return false;
        
        const endDate = new Date(member.endDate);
        const daysRemaining = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
        
        // Alerter si moins de 30 jours ou dépassé
        return daysRemaining <= 30;
    });
    
    const allAlerts = [];
    
    // Ajouter les alertes de paiements en retard
    unpaidMembers.slice(0, 3).forEach(member => {
        allAlerts.push({
            type: 'payment',
            member: member,
            html: `
                <div class="alert-item">
                    <div class="alert-item-icon">
                        <i class="fas fa-exclamation-circle"></i>
                    </div>
                    <div class="alert-item-content">
                        <div class="alert-item-title">${member.name}</div>
                        <div class="alert-item-text">Paiement en attente pour ce mois</div>
                    </div>
                    <div class="alert-item-badge">En retard</div>
                </div>
            `
        });
    });
    
    // Ajouter les alertes d'échéance
    endingSoonMembers.slice(0, 3).forEach(member => {
        const endDate = new Date(member.endDate);
        const daysRemaining = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
        const isOverdue = daysRemaining < 0;
        
        allAlerts.push({
            type: 'deadline',
            member: member,
            html: `
                <div class="alert-item" style="background: ${isOverdue ? '#fff5f5' : '#fffbeb'}; border-left: 3px solid ${isOverdue ? '#dc3545' : '#ffc107'};">
                    <div class="alert-item-icon" style="color: ${isOverdue ? '#dc3545' : '#ffc107'};">
                        <i class="fas fa-calendar-times"></i>
                    </div>
                    <div class="alert-item-content">
                        <div class="alert-item-title">${member.name}</div>
                        <div class="alert-item-text">
                            ${isOverdue 
                                ? `Échéance dépassée de ${Math.abs(daysRemaining)} jours` 
                                : `Échéance dans ${daysRemaining} jours`}
                        </div>
                    </div>
                    <div class="alert-item-badge" style="background: ${isOverdue ? '#dc3545' : '#ffc107'}; color: white;">
                        ${isOverdue ? 'Dépassé' : 'Urgent'}
                    </div>
                </div>
            `
        });
    });
    
    if (allAlerts.length === 0) {
        alertsCard.style.display = 'none';
        return;
    }
    
    alertsCard.style.display = 'block';
    
    alertsList.innerHTML = allAlerts.map(alert => alert.html).join('');
    
    const totalAlerts = unpaidMembers.length + endingSoonMembers.length;
    if (totalAlerts > allAlerts.length) {
        alertsList.innerHTML += `<p style="text-align:center;margin-top:10px;color:#5D6D7E;font-size:13px;">Et ${totalAlerts - allAlerts.length} autre(s) alerte(s)...</p>`;
    }
}

// Fonction de formatage de devise
function formatCurrency(amount) {
    const numericAmount = Number(amount);
    const rounded = Number.isFinite(numericAmount) ? Math.round(numericAmount) : 0;

    return new Intl.NumberFormat('fr-FR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(rounded) + ' FCFA';
}

// Dark mode toggle removed — functionality intentionally disabled.

// Actions rapides
function initQuickActions() {
    const quickAddPayment = document.getElementById('quickAddPayment');
    const quickAddMember = document.getElementById('quickAddMember');
    const quickExportData = document.getElementById('quickExportData');
    
    if (quickAddPayment) {
        quickAddPayment.addEventListener('click', () => {
            document.querySelector('[data-tab="payments"]')?.click();
            setTimeout(() => document.getElementById('addPaymentBtn')?.click(), 300);
        });
    }
    
    if (quickAddMember) {
        quickAddMember.addEventListener('click', () => {
            document.querySelector('[data-tab="members"]')?.click();
            setTimeout(() => document.getElementById('addMemberBtn')?.click(), 300);
        });
    }
    const bulkImportMembers = document.getElementById('bulkImportMembersBtn');
    if (bulkImportMembers) {
        bulkImportMembers.addEventListener('click', () => {
            document.querySelector('[data-tab="members"]')?.click();
            setTimeout(() => window.paymentManager.showBulkAddMembersModal(), 300);
        });
    }
    
    if (quickExportData) {
        quickExportData.addEventListener('click', () => {
            exportAllDataToExcel();
        });
    }
    
    const dismissAlerts = document.getElementById('dismissAlerts');
    if (dismissAlerts) {
        dismissAlerts.addEventListener('click', () => {
            document.getElementById('alertsCard').style.display = 'none';
        });
    }
}

// Export Excel amélioré
function exportAllDataToExcel() {
    // Vérifier que la librairie XLSX est disponible
    if (typeof XLSX === 'undefined') {
        const msg = 'La librairie XLSX n\'est pas chargée. Vérifiez la connexion internet ou placez xlsx.full.min.js dans /libs.';
        console.error(msg);
        if (window.paymentManager && typeof window.paymentManager.showNotification === 'function') {
            window.paymentManager.showNotification(msg, 'error');
        } else {
            alert(msg);
        }
        return;
    }

    try {
        const wb = XLSX.utils.book_new();
        
        // Feuille Membres — remplaçant: plage Juillet 2025 → Juin 2026 avec en-têtes fournis
        const start = new Date(2025, 6, 1); // juillet 2025
        const monthsRange = [];
        for (let i = 0; i < 12; i++) {
            const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
            const label = d.toLocaleString('fr-FR', { month: 'long' }) + ' ' + d.getFullYear();
            monthsRange.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: label.charAt(0).toLowerCase() + label.slice(1) });
        }

        const membersData = window.paymentManager.members.map((m, idx) => {
            const memberPayments = window.paymentManager.payments.filter(p => String(p.memberId) === String(m.id));

            const monthAmounts = monthsRange.map(mm => {
                let sum = 0;
                for (const p of memberPayments) {
                    if (!p) continue;
                    if (p.month === mm.key || p.monthKey === mm.key) { sum += Number(p.amount || 0); continue; }
                    if (p.date) {
                        const pd = new Date(p.date);
                        const k = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`;
                        if (k === mm.key) sum += Number(p.amount || 0);
                    }
                }
                return sum;
            });

            const totalPaid = monthAmounts.reduce((s, v) => s + v, 0);
            const nbreLots = Number(m.numberOfLots || 0);
            const unit = Number(m.monthlyQuota || 0) || (typeof window.paymentManager.getUnitPrice === 'function' ? Number(window.paymentManager.getUnitPrice()) : 0);
            const expectedTotal = (unit || 0) * 12;
            const reste = Math.max(0, expectedTotal - totalPaid);
            const statut = reste <= 0 ? 'Soldé' : 'En attente';

            const row = {
                'n°': idx + 1,
                'nom client': m.name || '',
                'nbre lot': nbreLots
            };

            monthsRange.forEach((mm, i) => {
                row[mm.label] = monthAmounts[i];
            });

            row['montannt verse'] = totalPaid;
            row['reste a payer'] = reste;
            row['statut'] = statut;

            return row;
        });

        const membersSheet = XLSX.utils.json_to_sheet(membersData, {skipHeader: false});
        XLSX.utils.book_append_sheet(wb, membersSheet, 'Membres_Plages');
        
        // Feuille Paiements
        const paymentsData = window.paymentManager.payments.map(p => {
            const member = window.paymentManager.members.find(m => m.id === p.memberId);
            return {
                'Date': new Date(p.date).toLocaleDateString('fr-FR'),
                'Membre': member?.name || 'Inconnu',
                'Montant': p.amount,
                'Mois': p.month,
                'Remarques': p.notes || ''
            };
        });
        const paymentsSheet = XLSX.utils.json_to_sheet(paymentsData);
        XLSX.utils.book_append_sheet(wb, paymentsSheet, 'Paiements');
        
        // Feuille Lots
        const lotsData = window.paymentManager.lots.map(l => ({
            'Nom': l.name,
            'Prix': l.price,
            'Localisation': l.location,
            'Description': l.description || '',
            'Disponible': l.available ? 'Oui' : 'Non',
            'Date création': new Date(l.createdAt).toLocaleDateString('fr-FR')
        }));
        const lotsSheet = XLSX.utils.json_to_sheet(lotsData);
        XLSX.utils.book_append_sheet(wb, lotsSheet, 'Lots');
        // Appliquer styles et couleurs aux feuilles (en-têtes + statut)
        const styleHeaders = (sheet, headerBg = 'FFCC00', headerFont = '000000') => {
            if (!sheet || !sheet['!ref']) return;
            const range = XLSX.utils.decode_range(sheet['!ref']);
            // définir largeurs de colonne par défaut
            sheet['!cols'] = new Array(range.e.c + 1).fill({ wpx: 110 });
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const addr = XLSX.utils.encode_cell({ r: range.s.r, c: C });
                const cell = sheet[addr];
                if (cell) {
                    cell.s = cell.s || {};
                    cell.s.fill = { fgColor: { rgb: headerBg } };
                    cell.s.font = Object.assign({}, cell.s.font || {}, { bold: true, color: { rgb: headerFont } });
                    cell.s.alignment = Object.assign({}, cell.s.alignment || {}, { horizontal: 'center', vertical: 'center' });
                }
            }
        };

        // Coloration conditionnelle pour la colonne 'statut' dans la feuille Membres_Plages
        const applyStatusColors = (sheet) => {
            if (!sheet || !sheet['!ref']) return;
            const range = XLSX.utils.decode_range(sheet['!ref']);
            // Trouver l'index de la colonne 'statut' sur la première ligne
            let statutCol = -1;
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const addr = XLSX.utils.encode_cell({ r: range.s.r, c: C });
                const cell = sheet[addr];
                if (cell && String(cell.v).toLowerCase().trim() === 'statut') {
                    statutCol = C;
                    break;
                }
            }
            if (statutCol === -1) return;

            for (let R = range.s.r + 1; R <= range.e.r; ++R) {
                const addr = XLSX.utils.encode_cell({ r: R, c: statutCol });
                const cell = sheet[addr];
                if (!cell) continue;
                const val = String(cell.v || '').toLowerCase();
                cell.s = cell.s || {};
                if (val === 'soldé' || val === 'solde' || val === 'solde') {
                    cell.s.fill = { fgColor: { rgb: 'C6EFCE' } }; // vert clair
                    cell.s.font = Object.assign({}, cell.s.font || {}, { color: { rgb: '006100' }, bold: true });
                } else {
                    cell.s.fill = { fgColor: { rgb: 'FFD966' } }; // orange clair
                    cell.s.font = Object.assign({}, cell.s.font || {}, { color: { rgb: '7F6000' }, bold: true });
                }
                cell.s.alignment = Object.assign({}, cell.s.alignment || {}, { horizontal: 'center' });
            }
        };

        // Appliquer aux feuilles
        try {
            // En-têtes et statut déjà gérés, ajouter bandes alternées et coloration des montants
            const applyTableColors = (sheet) => {
                if (!sheet || !sheet['!ref']) return;
                const range = XLSX.utils.decode_range(sheet['!ref']);
                // Bandes alternées pour les lignes (gris léger)
                for (let R = range.s.r + 1; R <= range.e.r; ++R) {
                    const isEven = (R - range.s.r) % 2 === 0;
                    for (let C = range.s.c; C <= range.e.c; ++C) {
                        const addr = XLSX.utils.encode_cell({ r: R, c: C });
                        const cell = sheet[addr];
                        if (!cell) continue;
                        cell.s = cell.s || {};
                        if (isEven) {
                            // Lignes alternées : bleu pâle
                            cell.s.fill = Object.assign({}, cell.s.fill || {}, { fgColor: { rgb: 'EAF4FF' } });
                        }
                    }
                }

                // Colorer les cellules de montants (colonnes numériques) en vert clair si >0
                for (let C = range.s.c; C <= range.e.c; ++C) {
                    // heuristique : si la colonne a un en-tête contenant 'mont' ou mois, on la traite
                    const headerAddr = XLSX.utils.encode_cell({ r: range.s.r, c: C });
                    const headerCell = sheet[headerAddr];
                    const headerText = headerCell ? String(headerCell.v || '').toLowerCase() : '';
                    if (headerText.includes('mont') || /\b\d{4}\b/.test(headerText) || headerText.match(/janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre/)) {
                        for (let R = range.s.r + 1; R <= range.e.r; ++R) {
                            const addr = XLSX.utils.encode_cell({ r: R, c: C });
                            const cell = sheet[addr];
                            if (!cell) continue;
                            const num = Number(cell.v);
                            if (!isNaN(num) && num > 0) {
                                cell.s = cell.s || {};
                                // Montants > 0 : fond vert très clair + texte vert foncé
                                cell.s.fill = Object.assign({}, cell.s.fill || {}, { fgColor: { rgb: 'DFF4DF' } });
                                cell.s.font = Object.assign({}, cell.s.font || {}, { color: { rgb: '006400' } });
                                cell.s.alignment = Object.assign({}, cell.s.alignment || {}, { horizontal: 'right' });
                            }
                        }
                    }
                }
            };

            styleHeaders(membersSheet, 'FFCC00', '000000');
            applyStatusColors(membersSheet);
            applyTableColors(membersSheet);
            styleHeaders(paymentsSheet, 'B4C6E7', '000000');
            styleHeaders(lotsSheet, 'E6F2FF', '000000');
        } catch (e) {
            console.warn('Impossible d\'appliquer les styles Excel :', e);
        }

        const fileName = `SIMMO_Export_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(wb, fileName);
        
        if (window.paymentManager) {
            window.paymentManager.showNotification('Export Excel réussi !', 'success');
        }
    } catch (error) {
        console.error('Erreur export Excel:', error);
        if (window.paymentManager) {
            window.paymentManager.showNotification('Erreur lors de l\'export', 'error');
        }
    }
}

// Export CSV personnalisé pour l'onglet Dashboard — en-têtes fournis par l'utilisateur
function exportMembersCsvForDashboard() {
    const manager = window.paymentManager;
    if (!manager) return;

    // Période demandée : Juillet 2025 -> Juin 2026 (12 mois)
    const start = new Date(2025, 6, 1); // juillet 2025 (month index 6)
    const months = [];
    for (let i = 0; i < 12; i++) {
        const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const label = d.toLocaleString('fr-FR', { month: 'long' }) + ' ' + y;
        const key = `${y}-${m}`;
        months.push({ key, label });
    }

    // En-têtes demandés (ordre exact) :
    const headers = [
        'n°',
        'nom client',
        'nbre lot',
        // mois individuels
        ...months.map(m => m.label.charAt(0).toLowerCase() + m.label.slice(1)),
        'montannt verse',
        'reste a payer',
        'statut'
    ];

    // Construire lignes
    const lines = [];
    lines.push(headers.join(';'));

    manager.members.forEach((m, idx) => {
        const memberPayments = manager.payments.filter(p => String(p.memberId) === String(m.id));

        // Calcul montant payé par mois (pour la période)
        const monthAmounts = months.map(mm => {
            // Cherche paiements correspondant au key (ex: '2025-07') ou par date
            let sum = 0;
            for (const p of memberPayments) {
                if (!p) continue;
                if (p.month === mm.key || p.monthKey === mm.key) {
                    sum += Number(p.amount || 0);
                    continue;
                }
                // fallback : comparer date
                if (p.date) {
                    const pd = new Date(p.date);
                    const k = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`;
                    if (k === mm.key) sum += Number(p.amount || 0);
                }
            }
            return sum;
        });

        const totalPaid = monthAmounts.reduce((s, v) => s + v, 0);

        // Estimation attendu : utiliser monthlyQuota si présent sinon unit price * nbre lots
        const nbreLots = Number(m.numberOfLots || 0);
        const unit = Number(m.monthlyQuota || 0) || (typeof window.paymentManager.getUnitPrice === 'function' ? Number(window.paymentManager.getUnitPrice()) : 0);
        const expectedTotal = (unit || 0) * 12; // sur la période 12 mois
        const reste = Math.max(0, expectedTotal - totalPaid);
        const statut = reste <= 0 ? 'Soldé' : 'En attente';

        // Préparer colonnes (format simple, point décimal en FR -> garder entier/float)
        const row = [];
        row.push(String(idx + 1));
        row.push((m.name || '').replace(/;/g, ','));
        row.push(String(nbreLots));
        monthAmounts.forEach(a => row.push(String(a || '')));
        row.push(String(totalPaid));
        row.push(String(reste));
        row.push(String(statut));

        lines.push(row.join(';'));
    });

    const bom = '\uFEFF'; // BOM pour Excel/UTF-8
    const csvContent = bom + lines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const fileName = `Membres_Plages_2025-07_2026-06_${new Date().toISOString().split('T')[0]}.csv`;

    // Téléchargement avec fallback et nettoyage
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.style.display = 'none';
    link.href = downloadUrl;
    link.setAttribute('download', fileName);

    try {
        // IE / old Edge
        if (navigator.msSaveOrOpenBlob) {
            navigator.msSaveOrOpenBlob(blob, fileName);
        } else {
            document.body.appendChild(link);
            // Le click ici doit être appelé pendant un geste utilisateur sinon certains navigateurs bloquent
            link.click();
            document.body.removeChild(link);
            // Revoquer l'URL après un court délai
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
        }

        if (window.paymentManager && typeof window.paymentManager.showNotification === 'function') {
            window.paymentManager.showNotification('Export CSV préparé pour téléchargement.', 'success');
        }
    } catch (err) {
        console.error('Erreur lors du téléchargement CSV :', err);
        if (window.paymentManager && typeof window.paymentManager.showNotification === 'function') {
            window.paymentManager.showNotification('Échec du téléchargement. Vérifiez les autorisations.', 'error');
        } else {
            alert('Échec du téléchargement. Vérifiez les autorisations du navigateur.');
        }
    }
}

// Génération de reçu PDF pour un paiement
function generatePaymentReceipt(paymentId) {
    const payment = window.paymentManager.payments.find(p => p.id === paymentId);
    if (!payment) return;
    
    const member = window.paymentManager.members.find(m => m.id === payment.memberId);
    if (!member) return;
    
    const receiptHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px; border: 2px solid #181818;">
            <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #6366F1; margin: 0;">CI Habitat</h1>
                <p style="color: #5D6D7E; margin: 5px 0;">Reçu de Paiement</p>
            </div>
            
            <div style="background: #F8F9FA; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <p style="margin: 5px 0;"><strong>N° Reçu:</strong> ${payment.id}</p>
                <p style="margin: 5px 0;"><strong>Date:</strong> ${new Date(payment.date).toLocaleDateString('fr-FR')}</p>
            </div>
            
            <div style="margin-bottom: 20px;">
                <h3 style="color: #2C3E50; border-bottom: 2px solid #6366F1; padding-bottom: 10px;">Informations</h3>
                <p style="margin: 10px 0;"><strong>Membre:</strong> ${member.name}</p>
                <p style="margin: 10px 0;"><strong>Téléphone:</strong> ${member.phone || 'N/A'}</p>
                <p style="margin: 10px 0;"><strong>Période:</strong> ${payment.month}</p>
            </div>
            
            <div style="background: #2C3E50; color: white; padding: 20px; border-radius: 8px; text-align: center;">
                <p style="margin: 0; font-size: 14px;">Montant Payé</p>
                <h2 style="margin: 10px 0; font-size: 32px;">${formatCurrency(payment.amount)}</h2>
            </div>
            
            ${payment.notes ? `
                <div style="margin-top: 20px; padding: 15px; background: #FFF5E6; border-left: 4px solid #F39C12; border-radius: 4px;">
                    <p style="margin: 0;"><strong>Remarques:</strong> ${payment.notes}</p>
                </div>
            ` : ''}
            
            <div style="margin-top: 40px; text-align: center; color: #5D6D7E; font-size: 12px;">
                <p>Merci pour votre confiance</p>
                <p>☎️ 01 618 837 90</p>
                <p style="margin-top: 20px;">Document généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}</p>
            </div>
        </div>
    `;
    
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = receiptHtml;
    tempDiv.style.position = 'absolute';
    tempDiv.style.left = '-9999px';
    document.body.appendChild(tempDiv);
    
    html2canvas(tempDiv.firstElementChild, {
        scale: 2,
        backgroundColor: '#ffffff'
    }).then(canvas => {
        document.body.removeChild(tempDiv);
        
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgData = canvas.toDataURL('image/png');
        const imgWidth = 190;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        
        pdf.addImage(imgData, 'PNG', 10, 10, imgWidth, imgHeight);
        pdf.save(`Recu_${member.name.replace(/\s+/g, '_')}_${payment.id}.pdf`);
        
        window.paymentManager.showNotification('Reçu PDF généré avec succès !', 'success');
    });
}

// Initialisation au chargement
document.addEventListener('DOMContentLoaded', () => {
    // Initialiser le toggle de vue
    initViewToggle();
    
    // Attendre que PaymentManager soit prêt
    const initEnhancements = () => {
        if (window.paymentManager) {
            initializeCharts();
            updateAlerts();
            // initThemeToggle(); removed — dark mode toggle UI disabled
            initQuickActions();
            initNotifications();
            
            // Initialiser les dates par défaut (12 derniers mois)
            const now = new Date();
            const startInput = document.getElementById('chartStartDate');
            const endInput = document.getElementById('chartEndDate');
            
            if (startInput && endInput) {
                const endYear = now.getFullYear();
                const endMonth = String(now.getMonth() + 1).padStart(2, '0');
                const startYear = now.getMonth() < 11 ? now.getFullYear() - 1 : now.getFullYear();
                const startMonth = String((now.getMonth() - 11 + 12) % 12 + 1).padStart(2, '0');
                
                startInput.value = `${startYear}-${startMonth}`;
                endInput.value = `${endYear}-${endMonth}`;
                
                // Gestionnaire pour le bouton Appliquer
                const applyBtn = document.getElementById('applyChartFilter');
                if (applyBtn) {
                    applyBtn.addEventListener('click', () => {
                        if (!startInput.value || !endInput.value) {
                            alert('Veuillez sélectionner une date de début et de fin');
                            return;
                        }
                        
                        const [startYear, startMonth] = startInput.value.split('-').map(Number);
                        const [endYear, endMonth] = endInput.value.split('-').map(Number);
                        const start = new Date(startYear, startMonth - 1, 1);
                        const end = new Date(endYear, endMonth - 1, 1);
                        
                        // Vérifier que début <= fin
                        if (start > end) {
                            alert('La date de début doit être antérieure ou égale à la date de fin');
                            return;
                        }
                        
                        // Vérifier que la période ne dépasse pas 12 mois
                        const monthsDiff = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
                        if (monthsDiff > 12) {
                            alert('La période ne peut pas dépasser 12 mois');
                            return;
                        }
                        
                        initializeCharts();
                    });
                }
            }
            
            // Observer les changements de données
            const originalRenderMembers = window.paymentManager.renderMembers;
            window.paymentManager.renderMembers = function() {
                originalRenderMembers.call(this);
                updateAlerts();
                updateTopContributors();
                updateNotifications();
                if (paymentsChart) {
                    initializeCharts();
                }
            };
            
            const originalRenderPayments = window.paymentManager.renderPayments;
            window.paymentManager.renderPayments = function() {
                originalRenderPayments.call(this);
                updateAlerts();
                updateTopContributors();
                updateNotifications();
                if (paymentsChart) {
                    initializeCharts();
                }
            };
        } else {
            setTimeout(initEnhancements, 100);
        }
    };
    
    initEnhancements();
});

// ======================
// SYSTÈME DE NOTIFICATIONS
// ======================

let notificationsData = [];

function initNotifications() {
    const notificationsBtn = document.getElementById('notificationsBtn');
    const notificationsDropdown = document.getElementById('notificationsDropdown');
    const markAllRead = document.getElementById('markAllRead');
    
    console.log('Initialisation des notifications...');
    console.log('Bouton trouvé:', notificationsBtn);
    console.log('Position du bouton:', notificationsBtn ? notificationsBtn.getBoundingClientRect() : 'N/A');
    console.log('Dropdown trouvé:', notificationsDropdown);
    
    // Test de visibilité
    if (notificationsBtn) {
        const styles = window.getComputedStyle(notificationsBtn);
        console.log('Display:', styles.display);
        console.log('Visibility:', styles.visibility);
        console.log('Opacity:', styles.opacity);
        console.log('Z-index:', styles.zIndex);
    }
    
    if (!notificationsBtn || !notificationsDropdown) {
        console.error('Éléments de notifications non trouvés!');
        return;
    }
    
    console.log('Système de notifications initialisé');
    
    // Toggle dropdown
    notificationsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        notificationsDropdown.classList.toggle('active');
    });
    
    // Fermer en cliquant ailleurs
    document.addEventListener('click', (e) => {
        if (!notificationsDropdown.contains(e.target) && e.target !== notificationsBtn) {
            notificationsDropdown.classList.remove('active');
        }
    });
    
    // Marquer tout comme lu
    if (markAllRead) {
        markAllRead.addEventListener('click', () => {
            notificationsData.forEach(notif => notif.read = true);
            saveNotifications();
            updateNotifications();
        });
    }
    
    // Bouton "Voir toutes les notifications"
    const viewAllBtn = document.getElementById('viewAllNotifications');
    if (viewAllBtn) {
        viewAllBtn.addEventListener('click', () => {
            // Fermer le dropdown
            notificationsDropdown.classList.remove('active');
            // Changer vers l'onglet notifications
            if (window.paymentManager) {
                window.paymentManager.switchTab('notifications');
            }
        });
    }
    
    // Bouton "Tout effacer" dans l'onglet notifications
    const clearAllBtn = document.getElementById('clearAllNotifications');
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', () => {
            if (confirm('Voulez-vous vraiment effacer toutes les notifications ?')) {
                notificationsData = [];
                saveNotifications();
                updateNotifications();
                renderNotificationsPage();
            }
        });
    }
    
    // Filtres de l'onglet notifications
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const filter = btn.dataset.filter;
            renderNotificationsPage(filter);
        });
    });
    
    // Charger les notifications sauvegardées
    loadNotifications();
    
    // Si aucune notification, créer une notification de bienvenue pour test
    if (notificationsData.length === 0) {
        addNotification(
            'info',
            'Bienvenue sur CI Habitat',
            'Système de notifications activé avec succès !',
            { welcome: true }
        );
    }
    
    updateNotifications();
}

function loadNotifications() {
    const saved = localStorage.getItem('simmo_notifications');
    if (saved) {
        notificationsData = JSON.parse(saved);
    }
}

function saveNotifications() {
    localStorage.setItem('simmo_notifications', JSON.stringify(notificationsData));
}

function addNotification(type, title, message, data = {}) {
    const notification = {
        id: Date.now() + Math.random(),
        type: type,
        title: title,
        message: message,
        data: data,
        timestamp: new Date().toISOString(),
        read: false
    };
    
    notificationsData.unshift(notification);
    
    // Garder seulement les 50 dernières notifications
    if (notificationsData.length > 50) {
        notificationsData = notificationsData.slice(0, 50);
    }
    
    saveNotifications();
    // NE PAS appeler updateNotifications() ici pour éviter la boucle infinie
    // updateNotifications() sera appelé par renderNotificationsList()
}

function updateNotifications() {
    if (!window.paymentManager) return;
    
    const notificationsList = document.getElementById('notificationsList');
    const notificationsBadge = document.getElementById('notificationsBadge');
    
    if (!notificationsList || !notificationsBadge) return;
    
    // Générer les notifications en temps réel (avec protection contre récursion)
    generateAutoNotifications();
    
    // Mettre à jour l'affichage après génération
    renderNotificationsList();
}

function renderNotificationsList() {
    const notificationsList = document.getElementById('notificationsList');
    const notificationsBadge = document.getElementById('notificationsBadge');
    
    if (!notificationsList || !notificationsBadge) return;
    
    // Afficher le badge
    const unreadCount = notificationsData.filter(n => !n.read).length;
    if (unreadCount > 0) {
        notificationsBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        notificationsBadge.style.display = 'flex';
    } else {
        notificationsBadge.style.display = 'none';
    }
    
    // Afficher les notifications
    if (notificationsData.length === 0) {
        notificationsList.innerHTML = `
            <div class="notifications-empty">
                <i class="fas fa-bell-slash"></i>
                <p>Aucune notification</p>
            </div>
        `;
        return;
    }
    
    notificationsList.innerHTML = notificationsData.slice(0, 10).map(notif => {
        const timeAgo = getTimeAgo(new Date(notif.timestamp));
        let iconClass = 'info';
        let iconHTML = '<i class="fas fa-info-circle"></i>';
        
        if (notif.type === 'payment') {
            iconClass = 'payment';
            iconHTML = '<i class="fas fa-money-bill-wave"></i>';
        } else if (notif.type === 'deadline') {
            iconClass = 'deadline';
            iconHTML = '<i class="fas fa-calendar-times"></i>';
        } else if (notif.type === 'alert') {
            iconClass = 'alert';
            iconHTML = '<i class="fas fa-exclamation-triangle"></i>';
        }
        
        return `
            <div class="notification-item ${notif.read ? '' : 'unread'}" onclick="markNotificationRead('${notif.id}')">
                <div class="notification-icon ${iconClass}">
                    ${iconHTML}
                </div>
                <div class="notification-content">
                    <div class="notification-title">
                        ${!notif.read ? '<span class="unread-dot"></span>' : ''}
                        ${notif.title}
                    </div>
                    <div class="notification-message">${notif.message}</div>
                    <div class="notification-time">
                        <i class="fas fa-clock"></i>
                        ${timeAgo}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Flag pour éviter la récursion infinie
let isGeneratingNotifications = false;

function generateAutoNotifications() {
    if (!window.paymentManager) return;
    
    // Empêcher la récursion infinie
    if (isGeneratingNotifications) return;
    isGeneratingNotifications = true;
    
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    // Vérifier les paiements manquants
    window.paymentManager.members.forEach(member => {
        const memberPayments = window.paymentManager.payments.filter(p => {
            const paymentDate = new Date(p.date);
            return p.memberId === member.id &&
                   paymentDate.getMonth() === currentMonth &&
                   paymentDate.getFullYear() === currentYear;
        });
        
        // Notification si aucun paiement ce mois
        if (memberPayments.length === 0) {
            const existingNotif = notificationsData.find(n => 
                n.type === 'alert' && 
                n.data.memberId === member.id &&
                n.data.month === `${currentYear}-${currentMonth}`
            );
            
            if (!existingNotif) {
                addNotification(
                    'alert',
                    'Paiement en attente',
                    `${member.name} n'a pas encore payé pour ce mois`,
                    { memberId: member.id, month: `${currentYear}-${currentMonth}` }
                );
            }
        }
    });
    
    // Vérifier les échéances proches
    window.paymentManager.members.forEach(member => {
        if (!member.endDate) return;
        
        const endDate = new Date(member.endDate);
        const daysRemaining = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
        
        if (daysRemaining <= 7 && daysRemaining > 0) {
            const existingNotif = notificationsData.find(n => 
                n.type === 'deadline' && 
                n.data.memberId === member.id &&
                Math.abs(new Date(n.timestamp) - now) < 24 * 60 * 60 * 1000 // Moins de 24h
            );
            
            if (!existingNotif) {
                addNotification(
                    'deadline',
                    'Échéance proche',
                    `${member.name} : Plus que ${daysRemaining} jours avant l'échéance`,
                    { memberId: member.id, daysRemaining: daysRemaining }
                );
            }
        } else if (daysRemaining < 0) {
            const existingNotif = notificationsData.find(n => 
                n.type === 'deadline' && 
                n.data.memberId === member.id &&
                n.data.overdue === true
            );
            
            if (!existingNotif) {
                addNotification(
                    'alert',
                    'Échéance dépassée',
                    `${member.name} : Échéance dépassée de ${Math.abs(daysRemaining)} jours`,
                    { memberId: member.id, daysRemaining: daysRemaining, overdue: true }
                );
            }
        }
    });
    
    // Réinitialiser le flag à la fin
    isGeneratingNotifications = false;
}

function markNotificationRead(notifId) {
    const notif = notificationsData.find(n => n.id == notifId);
    if (notif) {
        notif.read = true;
        saveNotifications();
        updateNotifications();
    }
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    const intervals = {
        année: 31536000,
        mois: 2592000,
        semaine: 604800,
        jour: 86400,
        heure: 3600,
        minute: 60
    };
    
    for (const [name, secondsInInterval] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / secondsInInterval);
        if (interval >= 1) {
            return `Il y a ${interval} ${name}${interval > 1 ? 's' : ''}`;
        }
    }
    
    return 'À l\'instant';
}

// Fonction pour afficher les notifications dans l'onglet
function renderNotificationsPage(filter = 'all') {
    const container = document.getElementById('notificationsPageContainer');
    if (!container) return;
    
    // Générer les notifications en temps réel
    if (window.paymentManager) {
        generateAutoNotifications();
    }
    
    let filteredNotifs = notificationsData;
    
    // Appliquer le filtre
    if (filter === 'unread') {
        filteredNotifs = notificationsData.filter(n => !n.read);
    } else if (filter !== 'all') {
        filteredNotifs = notificationsData.filter(n => n.type === filter);
    }
    
    // Afficher les notifications
    if (filteredNotifs.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-bell-slash"></i>
                <h3>Aucune notification</h3>
                <p>${filter === 'all' ? 'Aucune notification pour le moment' : 'Aucune notification dans cette catégorie'}</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = filteredNotifs.map(notif => {
        const timeAgo = getTimeAgo(new Date(notif.timestamp));
        let iconClass = 'info';
        let iconHTML = '<i class="fas fa-info-circle"></i>';
        
        if (notif.type === 'payment') {
            iconClass = 'payment';
            iconHTML = '<i class="fas fa-money-bill-wave"></i>';
        } else if (notif.type === 'deadline') {
            iconClass = 'deadline';
            iconHTML = '<i class="fas fa-calendar-times"></i>';
        } else if (notif.type === 'alert') {
            iconClass = 'alert';
            iconHTML = '<i class="fas fa-exclamation-triangle"></i>';
        }
        
        return `
            <div class="notification-item ${notif.read ? '' : 'unread'}" onclick="markNotificationRead('${notif.id}')">
                <div class="notification-icon ${iconClass}">
                    ${iconHTML}
                </div>
                <div class="notification-content">
                    <div class="notification-title">
                        ${!notif.read ? '<span class="unread-dot"></span>' : ''}
                        ${notif.title}
                    </div>
                    <div class="notification-message">${notif.message}</div>
                    <div class="notification-time">
                        <i class="fas fa-clock"></i>
                        ${timeAgo}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ======================
// VIEW TOGGLE (Liste / Cartes)
// ======================

function initViewToggle() {
    // Récupérer les préférences sauvegardées
    const membersView = localStorage.getItem('membersView') || 'card';
    const lotsView = localStorage.getItem('lotsView') || 'card';
    
    const membersGrid = document.getElementById('membersGrid');
    const lotsGrid = document.getElementById('lotsGrid');
    
    // Appliquer les vues sauvegardées
    if (membersView === 'list') {
        membersGrid?.classList.add('list-view');
    }
    if (lotsView === 'list') {
        lotsGrid?.classList.add('list-view');
    }
    
    // Event listeners pour tous les boutons de vue
    const viewButtons = document.querySelectorAll('.view-btn');
    viewButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const view = this.getAttribute('data-view');
            const section = this.getAttribute('data-section');
            
            // Mettre à jour l'état actif des boutons
            const parentToggle = this.closest('.view-toggle');
            parentToggle.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            // Appliquer la vue
            const grid = section === 'members' ? membersGrid : lotsGrid;
            if (grid) {
                if (view === 'list') {
                    grid.classList.add('list-view');
                } else {
                    grid.classList.remove('list-view');
                }
                
                // Sauvegarder la préférence
                localStorage.setItem(`${section}View`, view);
                
                // Re-renderer pour appliquer la nouvelle vue
                if (section === 'members' && window.paymentManager) {
                    window.paymentManager.renderMembers();
                } else if (section === 'lots' && window.paymentManager) {
                    window.paymentManager.renderLots();
                }
            }
        });
        
        // Restaurer l'état actif des boutons
        const section = btn.getAttribute('data-section');
        const view = btn.getAttribute('data-view');
        const savedView = localStorage.getItem(`${section}View`) || 'card';
        if (view === savedView) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

PaymentManager.prototype.maybeMigrateUnitPrice = function() {
        if (this._migrationDone) return;
        if (this._migrating) return;
        this._migrating = true;

        try {
            // 1) If config.unitPrice is missing but we have a lot price, set it
            if ((this.config == null || this.config.unitPrice == null) && this.lots && this.lots.length > 0) {
                const inferred = Number(this.lots[0].price) || 0;
                this.config = this.config || {};
                this.config.unitPrice = inferred;
                this.saveConfig();
            }

            const unit = this.getUnitPrice();
            if (unit > 0 && Array.isArray(this.members)) {
                let updated = false;
                this.members = this.members.map(member => {
                    const num = parseInt(member.numberOfLots) || 1;
                    const duration = parseInt(member.paymentDuration || member.duration) || 0;
                    const total = num * unit;
                    const monthly = duration > 0 ? Math.round((total / duration) / 100) * 100 : 0;
                    // If any key is missing or out of date, set and mark updated
                    if (member.unitPrice !== unit || member.totalLotAmount !== total || member.monthlyQuota !== monthly || member.duration !== duration) {
                        member.unitPrice = unit;
                        member.totalLotAmount = total;
                        member.monthlyQuota = monthly;
                        member.duration = duration || member.duration;
                        updated = true;
                    }
                    return member;
                });

                if (updated) {
                    this.saveMembers();
                }
            }

            // mark migration done for this session
            this._migrationDone = true;
        } catch (err) {
            console.error('Erreur lors de la migration du prix unitaire/membres :', err);
        } finally {
            this._migrating = false;
        }
    }