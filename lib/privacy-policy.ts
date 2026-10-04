const updatedOn = "4 October 2026";

export function privacyPolicyHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index,follow">
  <title>Privacy Policy · Anekio</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f8fc; color: #102a43; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.65; }
    header { background: #173b77; color: #fff; padding: 32px 24px 72px; }
    header > div, main { max-width: 860px; margin: 0 auto; }
    .brand { display: inline-flex; align-items: center; gap: 10px; color: #fff; font-weight: 800; font-size: 20px; text-decoration: none; }
    .mark { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 10px; background: #2e67f0; font-size: 17px; }
    h1 { margin: 44px 0 8px; font-size: clamp(32px, 5vw, 46px); line-height: 1.1; letter-spacing: -.035em; }
    header p { max-width: 600px; margin: 0; color: #dbeafe; }
    main { position: relative; margin-top: -38px; margin-bottom: 64px; padding: 36px clamp(22px, 5vw, 52px) 48px; border: 1px solid #dfe7f1; border-radius: 22px; background: #fff; box-shadow: 0 18px 48px rgba(15, 41, 66, .10); }
    .updated { display: inline-block; margin: 0 0 30px; padding: 6px 10px; border-radius: 999px; background: #eff6ff; color: #1d4ed8; font-size: 13px; font-weight: 700; }
    h2 { margin: 36px 0 8px; color: #173b77; font-size: 21px; line-height: 1.3; }
    h3 { margin: 24px 0 6px; font-size: 16px; }
    p, li { font-size: 16px; }
    ul { padding-left: 23px; }
    li + li { margin-top: 7px; }
    a { color: #1d4ed8; font-weight: 700; }
    .notice { margin-top: 28px; padding: 18px 20px; border: 1px solid #bfdbfe; border-radius: 14px; background: #eff6ff; }
    footer { margin-top: 42px; padding-top: 24px; border-top: 1px solid #e5edf6; color: #62748a; font-size: 14px; }
  </style>
</head>
<body>
  <header>
    <div>
      <a class="brand" href="/"><span class="mark">A</span> Anekio</a>
      <h1>Privacy Policy</h1>
      <p>How Anekio handles school, family, staff, and device information.</p>
    </div>
  </header>
  <main>
    <p class="updated">Last updated: ${updatedOn}</p>

    <p>Anekio is a school operations platform for schools, their staff, students, parents, and authorised administrators. This policy explains how Anekio collects, uses, stores, and shares personal and sensitive information when you use the Anekio mobile app, web application, public payment pages, and related services (together, the “Service”).</p>

    <h2>1. Who is responsible for your information</h2>
    <p>The school or organisation that invites you to Anekio controls the student, parent, staff, attendance, academic, and fee records it enters into the Service. Anekio processes those records on that school’s instructions to provide the Service. For school-owner enquiries, trials, subscriptions, and support requests made directly to Anekio, Anekio is responsible for the related contact and account information.</p>

    <h2>2. Information we collect</h2>
    <ul>
      <li><strong>Account and contact information:</strong> name, email address, mobile number, role, school or organisation, login identifiers, and password or one-time-code authentication data.</li>
      <li><strong>School operations records:</strong> student and parent details, date of birth, admission and class information, attendance, timetable, assessments, notices, documents, transport and fee settings. Schools may choose to enter additional information relevant to their own operations.</li>
      <li><strong>Financial records:</strong> invoices, fee line items, payment status, receipts, payment method, and payment references. Card, UPI, or bank credentials are handled by the payment provider and are not stored by Anekio.</li>
      <li><strong>Files and documents:</strong> documents, images, generated school records, and supporting uploads that an authorised user chooses to add.</li>
      <li><strong>Device and app information:</strong> device push-notification token and basic technical information needed to deliver notices, maintain security, and diagnose service failures.</li>
      <li><strong>Optional permissions:</strong> camera access only when you choose to scan a school or attendance QR code. Anekio does not access the camera when the scanner is not being used.</li>
      <li><strong>Connected-service data:</strong> if an authorised school user connects Google Sheets, we receive the Google account identity, access token, and the selected spreadsheet information needed to create, read, or import that sheet.</li>
    </ul>

    <h2>3. How we use information</h2>
    <ul>
      <li>Provide school operations features, account access, authentication, notices, documents, attendance, academic records, and fees.</li>
      <li>Create invoices and receipts, process or reconcile payments, and respond to payment, subscription, and support requests.</li>
      <li>Protect accounts, prevent fraud or misuse, troubleshoot, maintain, and improve the Service.</li>
      <li>Send service communications, including requested one-time login codes, password resets, payment confirmations, and notifications that a school chooses to send.</li>
      <li>Meet legal, accounting, regulatory, and enforceable government requirements where applicable.</li>
    </ul>

    <h2>4. How information is shared</h2>
    <p>We do not sell personal information or use student or school data for advertising. We share information only as needed to operate the Service:</p>
    <ul>
      <li><strong>Within a school:</strong> with authorised school administrators, staff, parents, and students according to the school’s configured access permissions.</li>
      <li><strong>Cloud infrastructure and storage:</strong> with hosting, database, and storage providers, including Vercel, Neon, and Amazon Web Services, that process information to host the Service and store authorised files.</li>
      <li><strong>Payments:</strong> with the payment provider selected by the school, such as Razorpay, Cashfree, or BillDesk, to create, verify, or reconcile an online payment. Their own privacy policies govern their handling of payment credentials.</li>
      <li><strong>Google:</strong> only when a school administrator elects to connect Google Sheets or uses Google authentication.</li>
      <li><strong>Service providers and authorities:</strong> with providers that help us operate the Service, or where disclosure is required by law, needed to protect rights and safety, or necessary in connection with a business transfer.</li>
    </ul>

    <h2>5. Retention and deletion</h2>
    <p>We keep school records while the school maintains its account and for the period needed to provide the Service, meet legal or accounting obligations, resolve disputes, and enforce agreements. A school administrator may request export or deletion of its organisation’s data by contacting us. Individual students, parents, and staff should first contact their school, which controls those records. We will process verified requests in accordance with applicable law and our obligations to the school.</p>

    <h2>6. Security</h2>
    <p>We use access controls, encrypted network connections, role-based permissions, authentication safeguards, and restricted cloud storage practices designed to protect information. No method of transmission or storage is completely secure, so users should protect their credentials and notify us promptly of suspected unauthorised access.</p>

    <h2>7. Children’s information</h2>
    <p>Anekio is used by schools to manage student records, including records about children. Schools are responsible for obtaining any notices, permissions, or consents required from parents or guardians. Anekio does not knowingly use children’s personal information for advertising or sell it.</p>

    <h2>8. Your choices and rights</h2>
    <p>Depending on applicable law, you may request access, correction, deletion, restriction, or a copy of information about you. Contact your school first for records it controls. For Anekio-controlled account, enquiry, trial, or support data, contact us using the details below. We may need to verify your identity and may retain limited information where required by law.</p>

    <h2>9. Changes to this policy</h2>
    <p>We may update this policy when the Service or legal requirements change. We will post the updated version on this page and revise the “Last updated” date. Material changes may also be communicated through the Service or to the relevant school administrator.</p>

    <h2>10. Contact us</h2>
    <p>For privacy questions, requests, or complaints, email <a href="mailto:support@anekio.com">support@anekio.com</a> with the subject line “Privacy request”.</p>

    <div class="notice"><strong>For Google Play users:</strong> this policy applies to the Anekio Android app (package <code>in.anekio.school</code>) as well as the Anekio web application.</div>

    <footer>© 2026 Anekio. This page is public and does not require sign-in.</footer>
  </main>
</body>
</html>`;
}
