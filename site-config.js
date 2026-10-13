/* Shared by the booking page and My Bookings. Edit your venue and payment details here. */
// Venue details shown in the footer and on My Bookings. Empty values are simply hidden.
const SITE = { address: "", phone: "", mapsQuery: "Mayha Square Pickleball Court" };
const PAYMENT = {
  holdMinutes: 30,
  // A method whose number still contains "X" is treated as not set up and hidden from customers.
  methods: [
    { id: "gcash", label: "GCash", accountName: "Jeffrey Rouisse Factor", number: "09393593728", qr: "./gcash-qr.png" },
    { id: "maya", label: "Maya", accountName: "YOUR NAME HERE", number: "09XX XXX XXXX", qr: "./maya-qr.png" }
  ].filter(method => !/X/i.test(method.number))
};
const SLOT_TIMES = ["12:00 AM", "1:00 AM", "2:00 AM", "3:00 AM", "4:00 AM", "5:00 AM", "6:00 AM", "7:00 AM", "8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM", "7:00 PM", "8:00 PM", "9:00 PM", "10:00 PM", "11:00 PM"];
const mapsUrl = () => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(SITE.address || SITE.mapsQuery)}`;
/* Public availability row: no names, phones or payment details. */
const availabilityRow = booking => ({ status: booking.status, ownerUid: booking.ownerUid, holdExpiresAt: booking.holdExpiresAt || 0, ...(booking.proofSubmittedAt ? { proofSubmittedAt: booking.proofSubmittedAt } : {}) });
/* The customer's own copy, read by My Bookings. */
const userBookingRow = (booking, courtKeyValue, timeKeys) => ({ reservationId: booking.reservationId, court: booking.court, courtKey: courtKeyValue, timeKeys, date: booking.date, startTime: booking.startTime, durationHours: booking.durationHours, totalPrice: booking.totalPrice, status: booking.status, paymentStatus: booking.paymentStatus, holdExpiresAt: booking.holdExpiresAt || 0, note: booking.note || "", createdAt: booking.createdAt, ...(booking.paymentReference ? { paymentReference: booking.paymentReference } : {}), ...(booking.paymentMethod ? { paymentMethod: booking.paymentMethod } : {}), ...(booking.proofSubmittedAt ? { proofSubmittedAt: booking.proofSubmittedAt } : {}), ...(booking.cancellationReason ? { cancellationReason: booking.cancellationReason } : {}) });
