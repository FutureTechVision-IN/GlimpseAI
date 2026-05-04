import React from "react";
import Layout from "../components/layout";
import { SUPPORT_EMAIL } from "@/lib/support";

export default function Terms() {
  return (
    <Layout>
      <div className="p-8 max-w-3xl mx-auto w-full prose prose-invert prose-zinc">
        <h1 className="text-3xl font-bold tracking-tight mb-6">Terms of Service</h1>
        <p className="text-zinc-400 text-sm mb-8">Last updated: April 18, 2026</p>

        <h2>1. Acceptance of Terms</h2>
        <p>By accessing and using GlimpseAI ("Service"), you agree to be bound by these Terms of Service. If you do not agree, please discontinue use immediately.</p>

        <h2>2. Service Description</h2>
        <p>GlimpseAI provides AI-powered image and video enhancement tools. The Service includes a free tier with limited enhancements and paid subscription plans with higher limits and advanced features.</p>

        <h2>3. User Accounts</h2>
        <p>You must provide accurate information when creating an account. You are responsible for maintaining the security of your credentials and all activity under your account.</p>

        <h2>4. Usage Limits</h2>
        <p>Free users receive 5 total enhancements. Paid subscribers are subject to daily (20/day) and monthly (600/month) limits based on their plan. Exceeding limits may result in temporary restriction of service.</p>

        <h2>5. Payment & Billing</h2>
        <p>Paid plans are billed monthly or annually via Razorpay. All prices are listed in INR. Subscriptions auto-renew unless cancelled. Refunds are handled on a case-by-case basis.</p>

        <h2>6. Content & Intellectual Property</h2>
        <p>You retain ownership of all images you upload and enhance. GlimpseAI does not claim rights to your content. Enhanced images are stored locally in your browser and are not retained on our servers beyond the processing window.</p>

        <h2>7. Prohibited Use</h2>
        <p>You may not use the Service to process illegal, harmful, or rights-infringing content. Automated scraping or abuse of the API is prohibited.</p>

        <h2>8. Limitation of Liability</h2>
        <p>GlimpseAI is provided "as-is." We are not liable for data loss, service interruptions, or damages arising from use of the Service.</p>

        <h2>9. Changes to Terms</h2>
        <p>We may update these Terms at any time. Continued use after changes constitutes acceptance.</p>

        <h2>10. Contact</h2>
        <p>Questions about these Terms? Contact us at <a href={`mailto:${SUPPORT_EMAIL}`} className="text-teal-400">{SUPPORT_EMAIL}</a>.</p>
      </div>
    </Layout>
  );
}
