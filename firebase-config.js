// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getDatabase, ref, set, get, push, update, remove, onValue } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyAn8qN6WNhQSByxJjppGNZXZ5B7_sG-MV4",
    authDomain: "simmo-21084.firebaseapp.com",
    databaseURL: "https://simmo-21084-default-rtdb.firebaseio.com",
    projectId: "simmo-21084",
    storageBucket: "simmo-21084.firebasestorage.app",
    messagingSenderId: "260886429597",
    appId: "1:260886429597:web:aeeb11ec2ad4715cf7b974",
    measurementId: "G-SBENTVR4SZ"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

export class FirebaseStorage {
    constructor() {
        this.db = database;
    }

    // Membres
    async saveMembers(members) {
        await set(ref(this.db, 'members'), members);
    }

    async getMembers() {
        const snapshot = await get(ref(this.db, 'members'));
        return snapshot.exists() ? snapshot.val() : [];
    }

    async addMember(member) {
        const members = await this.getMembers();
        members.push(member);
        await this.saveMembers(members);
    }

    async updateMember(memberId, updatedData) {
        const members = await this.getMembers();
        const index = members.findIndex(m => m.id === memberId);
        if (index !== -1) {
            members[index] = { ...members[index], ...updatedData };
            await this.saveMembers(members);
        }
    }

    async deleteMember(memberId) {
        const members = await this.getMembers();
        const filtered = members.filter(m => m.id !== memberId);
        await this.saveMembers(filtered);
    }

    // Paiements
    async savePayments(payments) {
        await set(ref(this.db, 'payments'), payments);
    }

    async getPayments() {
        const snapshot = await get(ref(this.db, 'payments'));
        return snapshot.exists() ? snapshot.val() : [];
    }

    async addPayment(payment) {
        const payments = await this.getPayments();
        payments.push(payment);
        await this.savePayments(payments);
    }

    async deletePayment(paymentId) {
        const payments = await this.getPayments();
        const filtered = payments.filter(p => p.id !== paymentId);
        await this.savePayments(filtered);
    }

    // Lots
    async saveLots(lots) {
        await set(ref(this.db, 'lots'), lots);
    }

    async getLots() {
        const snapshot = await get(ref(this.db, 'lots'));
        return snapshot.exists() ? snapshot.val() : [];
    }

    async addLot(lot) {
        const lots = await this.getLots();
        lots.push(lot);
        await this.saveLots(lots);
    }

    async updateLot(lotId, updatedData) {
        const lots = await this.getLots();
        const index = lots.findIndex(l => l.id === lotId);
        if (index !== -1) {
            lots[index] = { ...lots[index], ...updatedData };
            await this.saveLots(lots);
        }
    }

    async deleteLot(lotId) {
        const lots = await this.getLots();
        const filtered = lots.filter(l => l.id !== lotId);
        await this.saveLots(filtered);
    }

    // Sync en temps réel
    onMembersChange(callback) {
        onValue(ref(this.db, 'members'), (snapshot) => {
            callback(snapshot.exists() ? snapshot.val() : []);
        });
    }

    onPaymentsChange(callback) {
        onValue(ref(this.db, 'payments'), (snapshot) => {
            callback(snapshot.exists() ? snapshot.val() : []);
        });
    }

    onLotsChange(callback) {
        onValue(ref(this.db, 'lots'), (snapshot) => {
            callback(snapshot.exists() ? snapshot.val() : []);
        });
    }
}
