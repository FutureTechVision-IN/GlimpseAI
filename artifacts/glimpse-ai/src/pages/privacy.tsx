import React from "react";
import Layout from "../components/layout";
import { SUPPORT_EMAIL } from "@/lib/support";

export default function Privacy() {
  return (
    <Layout>
      <div className="p-8 max-w-3xl mx-auto w-full prose prose-invert prose-zinc">
        <h1 className="text-3xl font-bold tracking-tight mb-6">Privacy Policy</h1>
        <p className="text-zinc-400 text-sm mb-8">Last updated: April 18, 2026</p>

        <h2>1. Information We Collect</h2>
        <p>We collect the minimum information necessary to provide the Service:</p>
        <ul>
          <li><strong>Account data:</strong> Name, email address, and hashed password.</li>
          <li><strong>Usage data:</strong> Enhancement counts, plan information, and job metadata.</li>
          <li><strong>Payment data:</strong> Processed securely through Razorpay. We do not store card details.</li>
        </ul>

        <h2>2. Image Processing & Storage</h2>
        <p>Images uploaded for enhancement are processed in-memory and returned immediately. <strong>We do not permanently store your images on our servers.</strong> Your 5 most recent enhanced photos are stored locally in your browser's IndexedDB — this data never leaves your device.</p>

        <h2>3. How We Use Your Information</h2>
        <ul>
          <li>To provide and improve the Service</li>
          <li>To manage your subscription and billing</li>
          <li>To communicate important service updates</li>
          <li>To prevent abuse and enforce usage limits</li>
        </ul>

        <h2>4. Data Sharing</h2>
        <p>We do not sell or share your personal data with third parties, except:</p>
        <ul>
          <li>Razorpay for payment processing</li>
          <li>When required by law</li>
        </ul>

        <h2>5. Data Retention</h2>
        <p>Account data is retained while your account is active. You may request deletion at any time by contacting support. Local browser history is controlled entirely by you.</p>

        <h2>6. Security</h2>
        <p>We use industry-standard encryption (HTTPS, bcrypt password hashing) to protect your data. However, no system is 100% secure.</p>

        <h2>7. Your Rights</h2>
        <p>You have the right to access, correct, or delete your personal data. Contact us at <a href={`mailto:${SUPPORT_EMAIL}`} className="text-teal-400">{SUPPORT_EMAIL}</a> to exercise these rights.</p>

        <h2>8. Cookies</h2>
        <p>We use a session token stored in localStorage for authentication. We do not use third-party tracking cookies.</p>

        <h2>9. Changes</h2>
        <p>We may update this policy periodically. We'll notify you of significant changes via email or in-app notification.</p>
      </div>
    </Layout>
  );
}
