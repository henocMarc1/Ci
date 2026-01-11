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

// Charger le logo (base64) pour l'inclure dans les PDFs (cache en mémoire)
let __cachedLogoDataUrl = null;
async function getLogoDataUrl() {
    if (__cachedLogoDataUrl) return __cachedLogoDataUrl;
    // If a pre-embedded Data URL was generated server-side (logo.data.js), use it first.
    try {
        if (window && window.EMBEDDED_LOGO_DATA_URL) {
            __cachedLogoDataUrl = window.EMBEDDED_LOGO_DATA_URL;
            return __cachedLogoDataUrl;
        }
    } catch (e) {
        // ignore
    }
    // 1) try network fetch (works when served via http(s))
    try {
        const resp = await fetch('logo.jpeg', { cache: 'no-cache' });
        if (resp && resp.ok) {
            const blob = await resp.blob();
            const data = await new Promise((resolve, reject) => {
                const fr = new FileReader();
                fr.onload = () => resolve(fr.result);
                fr.onerror = reject;
                fr.readAsDataURL(blob);
            });
            __cachedLogoDataUrl = data;
            return data;
        }
    } catch (e) {
        console.warn('Logo fetch échoué (fallback)...', e);
    }

    // 2) fallback: try to read existing logo img in the DOM (if present)
    try {
        const imgEl = document.querySelector('#pillLogo') || document.querySelector('.pill-icon img') || document.querySelector('img[alt="logo"]');
        if (imgEl && imgEl.src) {
            // if already a data URL, use it
            if (imgEl.src.startsWith('data:')) {
                __cachedLogoDataUrl = imgEl.src;
                return __cachedLogoDataUrl;
            }

            // try to draw into canvas and get dataURL (may fail for CORS/file://)
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                // wait for image to be loaded
                if (!imgEl.complete) await new Promise(r => { imgEl.onload = r; imgEl.onerror = r; });
                canvas.width = imgEl.naturalWidth || 200;
                canvas.height = imgEl.naturalHeight || 200;
                ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/png');
                __cachedLogoDataUrl = dataUrl;
                return dataUrl;
            } catch (e2) {
                console.warn('Impossible de convertir le logo DOM en dataURL (CORS/file://?)', e2);
                // final fallback: return the img src (relative path) so HTML markup uses it
                return imgEl.src;
            }
        }
    } catch (e) {
        console.warn('Fallback DOM logo retrieval failed', e);
    }

    return null;
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
        // Defensive: some environments (file:// or when element missing) can make
        // document.getElementById('statsYearFilter') return null. Guard before reading .value
        const statsYearEl = document.getElementById('statsYearFilter');
        let year = new Date().getFullYear();
        if (statsYearEl && typeof statsYearEl.value !== 'undefined' && statsYearEl.value !== '') {
            const parsed = parseInt(statsYearEl.value, 10);
            if (!isNaN(parsed)) year = parsed;
        }

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

        // Attempt to inline the pill logo into the report header
        const _logoDataAnnual = typeof getLogoDataUrl === 'function' ? await getLogoDataUrl() : null;
        const _logoImgAnnual = _logoDataAnnual ? `<img src="${_logoDataAnnual}" alt="CI Habitat" style="width:86px;height:auto;vertical-align:middle;" />` : `<img src="logo.jpeg" alt="CI Habitat" style="width:86px;height:auto;vertical-align:middle;" />`;

        reportContainer.innerHTML = `
            <div class="pdf-header">
                <div class="pdf-logo-section">
                    ${_logoImgAnnual}
                    <div class="pdf-company-info" style="display:inline-block;vertical-align:middle;margin-left:12px;">
                        <h1>CI Habitat</h1>
                        <p>L'immobilier Autrement • Côte d'Ivoire</p>
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

        // Neutralize canvases (convert to images) to avoid tainted-canvas errors
        try {
            const canvases = reportContainer.querySelectorAll('canvas');
            canvases.forEach(c => {
                try {
                    const img = document.createElement('img');
                    img.src = c.toDataURL();
                    img.width = c.width || c.offsetWidth;
                    img.height = c.height || c.offsetHeight;
                    c.parentNode.replaceChild(img, c);
                } catch (e) {
                    const placeholder = document.createElement('div');
                    placeholder.style.width = (c.width || c.offsetWidth) + 'px';
                    placeholder.style.height = (c.height || c.offsetHeight) + 'px';
                    placeholder.style.background = '#f4f6f8';
                    c.parentNode.replaceChild(placeholder, c);
                }
            });

            // Replace external images that may taint canvas unless explicitly kept
            const imgs = reportContainer.querySelectorAll('img');
            imgs.forEach(img => {
                try {
                    if (img.dataset && img.dataset.keep === 'true') return;
                    const src = img.getAttribute('src') || '';
                    if (src && !src.startsWith('data:') && !src.startsWith('blob:')) {
                        img.setAttribute('data-original-src', src);
                        img.crossOrigin = 'anonymous';
                        // fallback to tiny transparent pixel to avoid taint when fetch not possible
                        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
                    }
                } catch (e) {
                    // ignore per-image errors
                }
            });
        } catch (e) {
            console.warn('Neutralisation images/canvases failed:', e);
        }

        const canvas = await html2canvas(reportContainer, { 
            scale: 2, 
            useCORS: true, 
            backgroundColor: '#ffffff',
            allowTaint: false,
            letterRendering: true
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
        const _logoDataMember = await getLogoDataUrl();
        const _logoImgMember = _logoDataMember ? `<img src="${_logoDataMember}" alt="CI Habitat" style="width:72px;height:auto;vertical-align:middle;" />` : `<img src="logo.jpeg" alt="CI Habitat" style="width:72px;height:auto;vertical-align:middle;" />`;
        reportContainer.innerHTML = `
            <div class="pdf-header">
                <div class="pdf-logo-section">
                    ${_logoImgMember}
                    <div class="pdf-company-info" style="display:inline-block;vertical-align:middle;margin-left:12px;">
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
                    ${await (async function(){ const d = await getLogoDataUrl(); return d ? `<img src="${d}" alt="CI Habitat" style="width:72px;height:auto;vertical-align:middle;" />` : `<img src="logo.jpeg" alt="CI Habitat" style="width:72px;height:auto;vertical-align:middle;" />`; })()}
                    <div class="pdf-company-info" style="display:inline-block;vertical-align:middle;margin-left:12px;">
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

                <div class="form-group" id="monthCheckboxGroup" style="display: none;">
                    <label class="form-label">Choisir les mois (cocher pour payer)</label>
                    <div id="monthCheckboxes" class="month-checkbox-list"></div>
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
        const monthCheckboxGroup = document.getElementById('monthCheckboxGroup');
        const monthCheckboxes = document.getElementById('monthCheckboxes');
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

            // If populateMonthsForMember returned a single auto month, keep old behavior
            if (autoMonth) {
                selectedMonth = autoMonth;
                this.calculateAndDisplayAmount(member, autoMonth);
                submitBtn.disabled = false;
            }
            // ensure checkbox group visibility is synchronized (populateMonthsForMember handles display)
            if (monthCheckboxGroup) {
                monthCheckboxGroup.style.display = monthCheckboxes && monthCheckboxes.children.length ? 'block' : 'none';
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
                        if (monthCheckboxGroup) monthCheckboxGroup.style.display = 'none';
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

        // Delegate checkbox change events for multi-month selection
        if (monthCheckboxes) {
            monthCheckboxes.addEventListener('change', (ev) => {
                const checkedEls = Array.from(monthCheckboxes.querySelectorAll('input[type="checkbox"]:checked'));
                // enable submit if any month selected
                submitBtn.disabled = checkedEls.length === 0 && !(selectedMonth);

                // compute total remaining for selected months
                let totalSelected = 0;
                checkedEls.forEach(c => {
                    const v = parseFloat(c.dataset.remaining || '0');
                    if (!isNaN(v)) totalSelected += v;
                });

                // update amount input to reflect sum of selected months
                if (amountInput && checkedEls.length > 0) {
                    // clamp to member overall remaining
                    const overallRemaining = selectedMember ? computeRemaining(selectedMember) : Infinity;
                    const toSet = Math.min(totalSelected, overallRemaining);
                    amountInput.value = toSet || '';
                    if (suggestedAmount) {
                        suggestedAmount.textContent = `Montant sélectionné: ${this.formatCurrency(toSet)}`;
                        suggestedAmount.style.display = 'block';
                    }
                    if (remainingAmount && selectedMember) {
                        remainingAmount.textContent = `Montant restant: ${this.formatCurrency(overallRemaining)}`;
                        remainingAmount.style.display = 'block';
                    }
                } else {
                    // no months selected — restore suggestion / clear selected hint
                    if (selectedMember && amountInput) {
                        const roundedMonthlyQuota = Math.round((selectedMember.monthlyQuota || 0) / 100) * 100;
                        amountInput.value = roundedMonthlyQuota || '';
                        if (suggestedAmount) {
                            suggestedAmount.textContent = `Montant suggéré: ${this.formatCurrency(roundedMonthlyQuota || 0)}`;
                            suggestedAmount.style.display = 'block';
                        }
                        if (remainingAmount) {
                            const remaining = computeRemaining(selectedMember);
                            remainingAmount.textContent = `Montant restant: ${this.formatCurrency(remaining)}`;
                            remainingAmount.style.display = 'block';
                        }
                    } else {
                        if (suggestedAmount) suggestedAmount.style.display = 'none';
                        if (remainingAmount) remainingAmount.style.display = 'none';
                    }
                }

                // if exactly one checkbox selected, show calculated amount for that month as before
                if (checkedEls.length === 1 && selectedMember) {
                    const mk = checkedEls[0].value;
                    this.calculateAndDisplayAmount(selectedMember, mk);
                }
            });
        }

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
            if (!selectedMember) {
                this.showToast('Veuillez sélectionner un membre', 'error');
                return;
            }

            const checked = monthCheckboxes ? Array.from(monthCheckboxes.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value) : [];

            if (checked.length > 0) {
                // Pay selected months individually (fill remaining for each month)
                const paymentDate = document.getElementById('paymentDate').value;
                const paymentsToAdd = [];
                const monthNames = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

                checked.forEach(mk => {
                    const alreadyPaidForMonth = this.payments
                        .filter(p => p.memberId === selectedMember.id && p.monthKey === mk)
                        .reduce((sum, p) => sum + (p.amount || 0), 0);
                    const needed = Math.max((selectedMember.monthlyQuota || 0) - alreadyPaidForMonth, 0);
                    if (needed <= 0) return; // skip fully paid months

                    const p = {
                        id: this.generateId(),
                        memberId: selectedMember.id,
                        amount: needed,
                        date: paymentDate,
                        monthKey: mk,
                        createdAt: new Date().toISOString()
                    };
                    paymentsToAdd.push(p);
                });

                if (paymentsToAdd.length === 0) {
                    this.showToast('Aucun mois sélectionné à payer (tous sont peut-être déjà payés)', 'error');
                    return;
                }

                const monthsCoveredKeys = paymentsToAdd.map(p => p.monthKey);
                const monthsCoveredLabels = monthsCoveredKeys.map(mk => {
                    const [y, m] = mk.split('-');
                    return `${monthNames[parseInt(m, 10)]} ${y}`;
                });

                this.payments.push(...paymentsToAdd);
                this.saveData();
                this.closeModal();
                this.updateUI();
                this.updateStats();
                this.showToast(`Paiement effectué pour: ${monthsCoveredLabels.join(', ')}`);
                const totalPaid = paymentsToAdd.reduce((s,p) => s + (p.amount || 0), 0);
                this.generatePaymentReceipt(paymentsToAdd[0], selectedMember, monthsCoveredLabels, totalPaid);
                return;
            }

            // Fallback to single-month flow
            if (selectedMonth) {
                this.addPaymentWithReceipt(selectedMember, selectedMonth);
            } else {
                this.showToast('Veuillez sélectionner au moins un mois à payer', 'error');
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
        const monthCheckboxesContainer = document.getElementById('monthCheckboxes');
        if (monthCheckboxesContainer) monthCheckboxesContainer.innerHTML = '';

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
            // build checkbox for multi-month selection
            if (monthCheckboxesContainer) {
                const cbId = `month_cb_${monthKey.replace(/[^a-zA-Z0-9]/g,'_')}`;
                const card = document.createElement('div');
                card.className = 'month-card';

                const label = document.createElement('label');
                label.className = 'month-checkbox-label';

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.value = monthKey;
                cb.id = cbId;
                cb.className = 'month-checkbox-input';
                cb.dataset.remaining = remainingForMonth;
                if (remainingForMonth <= 0) cb.disabled = true;

                const customBox = document.createElement('span');
                customBox.className = 'custom-checkbox';

                const info = document.createElement('div');
                info.className = 'month-info';
                const nameDiv = document.createElement('div');
                nameDiv.className = 'month-name';
                nameDiv.textContent = `${monthNames[month]} ${year}`;
                const amountDiv = document.createElement('div');
                amountDiv.className = 'month-amount';
                amountDiv.textContent = remainingForMonth > 0 ? this.formatCurrency(remainingForMonth) : 'Déjà payé';

                info.appendChild(nameDiv);
                info.appendChild(amountDiv);

                // Structure: input (hidden) + custom box + info — CSS will style based on input:checked
                label.appendChild(cb);
                label.appendChild(customBox);
                label.appendChild(info);

                if (remainingForMonth <= 0) card.classList.add('disabled');

                card.appendChild(label);
                monthCheckboxesContainer.appendChild(card);
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
        if (monthCheckboxesContainer) {
            const anyCheckbox = monthCheckboxesContainer.children && monthCheckboxesContainer.children.length;
            document.getElementById('monthCheckboxGroup').style.display = anyCheckbox ? 'block' : 'none';
        }

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

        const totalPaid = paymentsToAdd.reduce((s,p) => s + (p.amount || 0), 0);
        this.generatePaymentReceipt(paymentsToAdd[0], member, monthsCoveredLabels, totalPaid);
    }

async generatePaymentReceipt(payment, member, monthsCovered, totalAmount) {
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

        const displayAmount = (typeof totalAmount === 'number') ? totalAmount : (payment.amount || 0);
        const amountReadable = this.formatCurrency(displayAmount || 0);

        const reportContainer = document.createElement('div');
        reportContainer.className = 'pdf-report-container receipt-vertical';

        reportContainer.style.width = '794px';
        reportContainer.style.background = '#ffffff';
        reportContainer.style.color = '#222';
        reportContainer.style.padding = '28px';
        reportContainer.style.boxSizing = 'border-box';
        reportContainer.style.fontFamily = "'Inter', Arial, sans-serif";

        // Charger le logo en base64 (si possible) et l'injecter dans le template
        const _logoData = await getLogoDataUrl();
        const _logoImgHtml = _logoData ? `<img src="${_logoData}" alt="CI Habitat" style="width:72px;height:auto;vertical-align:middle;" />` : `<img src="logo.jpeg" alt="CI Habitat" style="width:72px;height:auto;vertical-align:middle;" />`;

        reportContainer.innerHTML = `
            <div class="receipt">
                <div class="receipt-header">
                    <div class="receipt-company">
                        ${_logoImgHtml}
                        <div style="display:inline-block;margin-left:12px;vertical-align:middle;">
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

        // Supprimer/neutraliser les éléments susceptibles de "taint" le canvas
        try {
            // enlever tous les canvas à l'intérieur du container
            reportContainer.querySelectorAll('canvas').forEach(c => c.remove());

            // remplacer les images externes par un substitut texte pour éviter les problèmes CORS
            reportContainer.querySelectorAll('img').forEach(img => {
                // ne pas remplacer les images déjà inline (data:), ni le logo de l'app
                try {
                    const srcAttr = img.getAttribute && img.getAttribute('src') ? img.getAttribute('src') : (img.src || '');
                    const fileName = String(srcAttr).split('/').pop() || '';
                    if (/^data:/i.test(srcAttr) || /logo\.(png|jpe?g|svg)$/i.test(fileName) || img.dataset.keep === 'true') return;
                } catch(e) {}
                const placeholder = document.createElement('div');
                placeholder.style.width = img.width ? img.width + 'px' : '80px';
                placeholder.style.height = img.height ? img.height + 'px' : '40px';
                placeholder.style.display = 'inline-block';
                placeholder.style.background = '#f4f4f4';
                placeholder.style.color = '#666';
                placeholder.style.fontSize = '12px';
                placeholder.style.lineHeight = placeholder.style.height;
                placeholder.style.textAlign = 'center';
                placeholder.style.verticalAlign = 'middle';
                placeholder.textContent = img.alt || '';
                img.replaceWith(placeholder);
            });
        } catch (e) {
            console.warn('Erreur lors de la neutralisation des éléments externes pour le PDF:', e);
        }

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

// Génération de reçu PDF pour un paiement (délégué)
function generatePaymentReceipt(paymentId) {
    try {
        const pm = window.paymentManager;
        if (!pm || typeof pm.generatePaymentReceipt !== 'function') return;
        const payment = pm.payments.find(p => p.id === paymentId);
        if (!payment) return;
        const member = pm.members.find(m => m.id === payment.memberId) || null;

        const monthsCovered = Array.isArray(payment.monthsCovered) && payment.monthsCovered.length
            ? payment.monthsCovered
            : (payment.monthKey ? [payment.monthKey] : []);

        const totalAmount = payment.totalAmount || payment.amount || 0;
        pm.generatePaymentReceipt(payment, member, monthsCovered, totalAmount);
    } catch (err) {
        console.error('Erreur en déléguant la génération du reçu :', err);
    }
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
    const markAllReadBtns = document.querySelectorAll('#markAllRead');
    
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
    
    // Marquer tout comme lu (attacher à tous les boutons présents)
    if (markAllReadBtns && markAllReadBtns.length) {
        markAllReadBtns.forEach(btn => btn.addEventListener('click', () => {
            notificationsData.forEach(notif => notif.read = true);
            saveNotifications();
            updateNotifications();
            if (window.paymentManager && window.paymentManager.currentTab === 'notifications') renderNotificationsPage();
        }));
    }
    
    // Bouton "Voir toutes les notifications"
    const viewAllBtns = document.querySelectorAll('#viewAllNotifications');
    if (viewAllBtns && viewAllBtns.length) {
        viewAllBtns.forEach(btn => btn.addEventListener('click', () => {
            // Fermer le dropdown
            notificationsDropdown.classList.remove('active');
            // Changer vers l'onglet notifications
            if (window.paymentManager) {
                window.paymentManager.switchTab('notifications');
            }
        }));
    }
    
    // Bouton "Tout effacer" dans l'onglet notifications
    const clearAllBtns = document.querySelectorAll('#clearAllNotifications');
    if (clearAllBtns && clearAllBtns.length) {
        clearAllBtns.forEach(btn => btn.addEventListener('click', () => {
            if (confirm('Voulez-vous vraiment effacer toutes les notifications ?')) {
                notificationsData = [];
                saveNotifications();
                updateNotifications();
                renderNotificationsPage();
            }
        }));
    }

    // Effacer les notifications lues (attacher à tous les boutons trouvés)
    const clearReadBtns = document.querySelectorAll('#clearReadNotifications');
    if (clearReadBtns && clearReadBtns.length) {
        clearReadBtns.forEach(btn => btn.addEventListener('click', () => {
            if (!confirm('Effacer toutes les notifications lues ?')) return;
            notificationsData = notificationsData.filter(n => !n.read);
            saveNotifications();
            updateNotifications();
            if (window.paymentManager && window.paymentManager.currentTab === 'notifications') renderNotificationsPage();
        }));
    }

    // Handler central pour actions rapides sur notifications
    function handleNotificationAction(action, id, memberId) {
        console.log('handleNotificationAction called', { action, id, memberId, paymentManager: !!window.paymentManager });
        const notifIndex = notificationsData.findIndex(n => n.id == id);
        const notif = notificationsData[notifIndex];
        if (!notif && action !== 'delete') return;

        if (action === 'toggle') {
            notif.read = !notif.read;
            saveNotifications();
            updateNotifications();
            if (window.paymentManager && window.paymentManager.currentTab === 'notifications') renderNotificationsPage();
            return;
        }

        if (action === 'delete') {
            notificationsData = notificationsData.filter(n => n.id != id);
            saveNotifications();
            updateNotifications();
            if (window.paymentManager && window.paymentManager.currentTab === 'notifications') renderNotificationsPage();
            return;
        }

        if (action === 'view-member' && memberId && window.paymentManager) {
            const member = (window.paymentManager.members || []).find(m => String(m.id) === String(memberId));
            window.paymentManager.switchTab('members');
            setTimeout(() => {
                try {
                    // Si on a trouvé le membre, remplir la recherche et forcer le rendu
                    const memberSearch = document.getElementById('memberSearch');
                    if (member && memberSearch) {
                        memberSearch.value = member.name || '';
                        memberSearch.dispatchEvent(new Event('input', { bubbles: true }));
                        if (typeof window.paymentManager.renderMembers === 'function') {
                            window.paymentManager.renderMembers();
                        }
                    }

                    // Sélectionner et scroller vers l'élément si présent
                    if (typeof window.paymentManager.selectMember === 'function') {
                        window.paymentManager.selectMember(memberId);
                    }
                    const el = document.querySelector(`[data-member-id="${memberId}"]`);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } catch (err) {
                    console.warn('Impossible de sélectionner le membre:', err);
                }
            }, 250);
            return;
        }
        
        if (action === 'reminder' && memberId && window.paymentManager) {
            const member = (window.paymentManager.members || []).find(m => String(m.id) === String(memberId));
            if (!member) return;
            // compute missing months (last 6 months) for the member
            const missing = window.paymentManager.getMissingMonthsForMember(member, 6);
            const monthList = missing.map(m => `${m.display}`).join(', ');
            const defaultMsg = `Bonjour ${member.name},\n\nCeci est un rappel de paiement pour les mois suivants : ${monthList}.\n\nMerci de régulariser votre situation dès que possible.\n\nCordialement,\nCI Habitat`;
            // allow user to edit message before generating
            const userMsg = prompt('Modifier le message de rappel avant génération du PDF :', defaultMsg) || defaultMsg;
            window.paymentManager.generateReminderPdf(member, missing, userMsg, id);
            return;
        }
    }

    // Délégation d'événements pour actions rapides (dropdown miniature)
    const notificationsList = document.getElementById('notificationsList');
    if (notificationsList) {
        notificationsList.addEventListener('click', (e) => {
            const actionBtn = e.target.closest('.notif-action');
            if (actionBtn) {
                e.stopPropagation();
                const action = actionBtn.dataset.action;
                const id = actionBtn.dataset.id;
                const memberId = actionBtn.dataset.memberId;
                handleNotificationAction(action, id, memberId);
                return;
            }

            const item = e.target.closest('.notification-item');
            if (item && item.dataset && item.dataset.id) {
                markNotificationRead(item.dataset.id);
            }
        });
    }

    // Délégation d'événements pour la page complète des notifications
    const pageContainer = document.getElementById('notificationsPageContainer');
    if (pageContainer) {
        pageContainer.addEventListener('click', (e) => {
            const actionBtn = e.target.closest('.notif-action');
            if (actionBtn) {
                e.stopPropagation();
                const action = actionBtn.dataset.action;
                const id = actionBtn.dataset.id;
                const memberId = actionBtn.dataset.memberId;
                handleNotificationAction(action, id, memberId);
                return;
            }

            const item = e.target.closest('.notification-item');
            if (item && item.dataset && item.dataset.id) {
                markNotificationRead(item.dataset.id);
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
            <div class="notification-item ${notif.read ? '' : 'unread'}" data-id="${notif.id}">
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
                    <div class="notification-actions">
                    <button class="notif-action" data-action="toggle" data-id="${notif.id}" title="${notif.read ? 'Marquer non lu' : 'Marquer lu'}">
                        <i class="fas ${notif.read ? 'fa-undo' : 'fa-check'}"></i>
                    </button>
                    ${notif.data && notif.data.memberId ? `<button class="notif-action" data-action="view-member" data-id="${notif.id}" data-member-id="${notif.data.memberId}" title="Voir le membre"><i class="fas fa-user"></i></button>` : ''}
                    ${notif.data && notif.data.memberId ? `<button class="notif-action" data-action="reminder" data-id="${notif.id}" data-member-id="${notif.data.memberId}" title="Générer rappel"><i class="fas fa-file-pdf"></i></button>` : ''}
                    <button class="notif-action" data-action="delete" data-id="${notif.id}" title="Supprimer"><i class="fas fa-trash"></i></button>
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
            <div class="notification-item ${notif.read ? '' : 'unread'}" data-id="${notif.id}">
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
                <div class="notification-actions">
                    <button class="notif-action" data-action="toggle" data-id="${notif.id}" title="${notif.read ? 'Marquer non lu' : 'Marquer lu'}">
                        <i class="fas ${notif.read ? 'fa-undo' : 'fa-check'}"></i>
                    </button>
                    ${notif.data && notif.data.memberId ? `<button class="notif-action" data-action="view-member" data-id="${notif.id}" data-member-id="${notif.data.memberId}" title="Voir le membre"><i class="fas fa-user"></i></button>` : ''}
                    ${notif.data && notif.data.memberId ? `<button class="notif-action" data-action="reminder" data-id="${notif.id}" data-member-id="${notif.data.memberId}" title="Générer rappel"><i class="fas fa-file-pdf"></i></button>` : ''}
                    <button class="notif-action" data-action="delete" data-id="${notif.id}" title="Supprimer"><i class="fas fa-trash"></i></button>
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

    // Retourne un tableau des mois manquants pour un membre (derniers `monthsBack` mois)
    PaymentManager.prototype.getMissingMonthsForMember = function(member, monthsBack = 6) {
        try {
            const now = new Date();
            const months = [];
            const paidSet = new Set((this.payments || []).filter(p => String(p.memberId) === String(member.id)).map(p => {
                const d = new Date(p.date);
                return `${d.getFullYear()}-${d.getMonth()}`;
            }));

            for (let i = 0; i < monthsBack; i++) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const key = `${d.getFullYear()}-${d.getMonth()}`;
                if (!paidSet.has(key)) {
                    const display = d.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
                    months.push({ key, year: d.getFullYear(), month: d.getMonth(), display });
                }
            }
            return months.reverse(); // du plus ancien au plus récent
        } catch (e) {
            console.warn('Erreur getMissingMonthsForMember', e);
            return [];
        }
    }

    // Génère et télécharge un PDF de rappel stylé pour un membre
    PaymentManager.prototype.generateReminderPdf = async function(member, missingMonths = [], message = '', notifId) {
        try {
            this.showNotification('Génération du PDF de rappel en cours...', 'info');

            const logoData = await getLogoDataUrl();
            const container = document.createElement('div');
            container.className = 'pdf-reminder-container';
            container.style.padding = '28px';
            container.style.fontFamily = "'Inter', Arial, Helvetica, sans-serif";
            container.style.fontSize = '22px';
            container.style.maxWidth = '820px';
            container.style.width = '100%';
            const monthsHtml = missingMonths.length ? `<ul style="padding-left:20px;margin:0;font-size:16px;line-height:1.6">${missingMonths.map(m => `<li style=\"margin-bottom:6px;color:#111;font-weight:700\">${m.display}</li>`).join('')}</ul>` : '<p style="color:#6b7280;font-size:18px">Aucun mois spécifié</p>';
            // Only use inline image if it's a data URL (to avoid CORS/taint issues when running from file://)
            let logoHtml = '<div style="width:72px;height:72px;background:#eee;border-radius:8px"></div>';
            try {
                if (logoData && typeof logoData === 'string' && logoData.startsWith('data:')) {
                    logoHtml = `<img src="${logoData}" alt="logo" style="height:72px;">`;
                } else {
                    console.log('Skipping external logo in PDF render to avoid CORS/taint (logoData):', logoData && typeof logoData === 'string' ? logoData.slice(0,80) : logoData);
                }
            } catch (e) {
                console.warn('Error while preparing logoHtml', e);
            }

            // Card-like layout with watermark and nicer chips
            const watermarkHtml = (logoData && typeof logoData === 'string' && logoData.startsWith('data:')) ? `<img src="${logoData}" style="position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);width:480px;opacity:0.06;filter:grayscale(1);pointer-events:none;" />` : '';
            container.innerHTML = `
                <div style="position:relative;">
                    ${watermarkHtml}
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                        <div style="display:flex;align-items:center;gap:14px;">
                            ${logoHtml}
                            <div>
                                <h2 style="margin:0;font-size:34px;color:#0b3d91;letter-spacing:0.5px">CI Habitat</h2>
                                <div style="margin-top:6px;font-size:14px;color:#374151;font-weight:600">Tel: +225 0584103275</div>
                                <div style="color:#6b7280;font-size:15px">L'immobilier Autrement • Côte d'Ivoire</div>
                            </div>
                        </div>
                        <div style="text-align:right;color:#374151;font-size:13px;">Date: ${new Date().toLocaleDateString('fr-FR')}</div>
                    </div>

                    <div style="background:#ffffff;border-radius:12px;padding:22px;box-shadow:0 10px 30px rgba(16,24,40,0.08);">
                        <div style="margin-bottom:10px;color:#374151;font-size:15px;font-weight:700">Destinataire</div>
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px;">
                            <div>
                                <div style="font-weight:900;font-size:26px;color:#111">${member.name || 'N/A'}</div>
                                <div style="color:#6b7280;font-size:15px">${member.email || ''}</div>
                            </div>
                        </div>

                        <div style="margin-bottom:18px;font-size:20px;color:#111;line-height:1.7">${message.replace(/\n/g, '<br>')}</div>

                        <div style="margin-bottom:18px;">
                            <div style="font-weight:800;color:#374151;margin-bottom:8px;font-size:16px">Mois(s) concernés</div>
                            <div>${monthsHtml}</div>
                        </div>

                        <div style="margin-top:18px;color:#374151;font-size:15px">Cordialement,<br/><strong>CI Habitat</strong></div>

                        <div style="display:flex;justify-content:center;margin-top:34px;">
                            <div style="margin-top:18px;font-weight:900;font-size:22px;border-top:3px solid #111;padding-top:10px;width:180px;text-align:center;">CACHET</div>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(container);
            await new Promise(r => setTimeout(r, 300));

            // Ensure canvas matches container size; increase scale for better print quality
            const canvas = await html2canvas(container, { 
                scale: Math.max(2, (window.devicePixelRatio || 1)), 
                useCORS: true, 
                backgroundColor: '#ffffff',
                width: container.offsetWidth,
                height: container.offsetHeight
            });
            document.body.removeChild(container);

            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const imgData = canvas.toDataURL('image/png');
            // Fill full A4 width (210mm) and no horizontal margin
            const imgWidth = 210;
            const pageHeight = 297;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;
            let heightLeft = imgHeight;
            let position = 0;

            pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;
            while (heightLeft >= 0) {
                position = heightLeft - imgHeight + 0;
                pdf.addPage();
                pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;
            }

            const safeName = (member.name || 'rappel').replace(/[^a-z0-9_\-\.]/gi, '_');
            const fileName = `Rappel_${safeName}_${Date.now()}.pdf`;
            pdf.save(fileName);

            this.showNotification('PDF de rappel généré et téléchargé.', 'success');

            // Optionnel: marquer la notification comme traitée
            if (notifId) {
                const n = notificationsData.find(x => x.id == notifId);
                if (n) { n.read = true; saveNotifications(); updateNotifications(); }
            }
        } catch (err) {
            console.error('Erreur génération rappel PDF', err);
            this.showNotification('Erreur lors de la génération du PDF de rappel', 'error');
        }
    }