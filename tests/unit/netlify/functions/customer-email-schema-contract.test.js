"use strict";

const fs = require("fs");
const path = require("path");

describe("customer-facing email schema contract", () => {
  test("booking and communication flows normalize tenant business names", () => {
    const bookingReminders = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/booking-reminders.js"),
      "utf8"
    );
    const cancelBooking = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/cancel-booking.js"),
      "utf8"
    );
    const createBooking = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/create-booking.js"),
      "utf8"
    );
    const replyCustomerMessage = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/reply-customer-message.js"),
      "utf8"
    );
    const requestReview = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/request-review.js"),
      "utf8"
    );
    const sendBidEmail = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/send-bid-email.js"),
      "utf8"
    );
    const sendBookingReminder = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/send-booking-reminder.js"),
      "utf8"
    );
    const updateBooking = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/update-booking.js"),
      "utf8"
    );

    expect(bookingReminders).toContain(".select('business_name, name')");
    expect(bookingReminders).toContain("function businessNameFromTenant(tenant)");
    expect(cancelBooking).toContain(".select('business_name, name')");
    expect(cancelBooking).toContain("business_name : businessNameFromTenant(tenant)");
    expect(createBooking).toContain(".select('business_name, name')");
    expect(createBooking).toContain("businessName: businessNameFromTenant(tenant)");
    expect(replyCustomerMessage).toContain(".select('business_name, name')");
    expect(replyCustomerMessage).toContain("const businessName = businessNameFromTenant(tenant);");
    expect(requestReview).toContain(".select('business_name, name')");
    expect(sendBidEmail).toContain(".select('business_name, name')");
    expect(sendBookingReminder).toContain(".select('business_name, name')");
    expect(updateBooking).toContain(".select('business_name, name')");
  });
});
