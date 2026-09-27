import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Privacy Policy - StreetSweep',
};

export default function PrivacyPolicyPage() {
    return (
        <main className="max-w-3xl mx-auto px-6 py-12 text-gray-800">
            <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
            <p className="text-sm text-gray-500 mb-8">Last updated: September 27, 2026</p>

            <p className="mb-6">
                StreetSweep ("we", "us") helps cyclists and runners find and route streets
                they haven't covered yet. This policy explains what data StreetSweep
                collects, how it's used, and your choices.
            </p>

            <h2 className="text-xl font-semibold mt-8 mb-2">Information We Collect</h2>
            <ul className="list-disc pl-6 space-y-2 mb-6">
                <li>
                    <strong>Account information:</strong> if you sign in, we store your
                    name, email address, and profile image as provided by your sign-in
                    provider (e.g. Google, Strava).
                </li>
                <li>
                    <strong>Activity and GPS data:</strong> if you connect Strava or Ride
                    with GPS, we import your activity GPS traces (routes/polylines) so we
                    can determine which streets you've already ridden or run. We do not
                    import photos, comments, or other social content from these services.
                </li>
                <li>
                    <strong>Routes you create:</strong> routes and collections you generate
                    or save within StreetSweep are stored so you can access them later.
                </li>
                <li>
                    <strong>OAuth tokens:</strong> access and refresh tokens issued by
                    connected services (Google, Strava, Ride with GPS) are stored so we can
                    keep your connection active without asking you to re-authenticate
                    repeatedly.
                </li>
            </ul>

            <h2 className="text-xl font-semibold mt-8 mb-2">How We Use Your Information</h2>
            <ul className="list-disc pl-6 space-y-2 mb-6">
                <li>To generate street-coverage routes and maps for your account.</li>
                <li>To keep your connected accounts (Google, Strava, Ride with GPS) linked.</li>
                <li>To save and let you retrieve your generated routes and collections.</li>
            </ul>
            <p className="mb-6">
                We do not sell your personal information, and we do not use your GPS or
                activity data for advertising.
            </p>

            <h2 className="text-xl font-semibold mt-8 mb-2">Your Data Is Private to You</h2>
            <p className="mb-6">
                Your account, activity, and route data are private to your account.
                Other StreetSweep users cannot see or access your GPS traces, ridden
                streets, saved routes, or collections. StreetSweep staff do not access
                individual user data except as needed to operate the Service (e.g.
                debugging an error you report) or where required by law.
            </p>

            <h2 className="text-xl font-semibold mt-8 mb-2">Third-Party Services</h2>
            <p className="mb-6">
                StreetSweep integrates with third-party services (Google, Strava, Ride
                with GPS, OpenStreetMap/Overpass) to provide its functionality. Your use
                of those services is also governed by their own privacy policies and
                terms.
            </p>

            <h2 className="text-xl font-semibold mt-8 mb-2">Data Retention &amp; Deletion</h2>
            <p className="mb-6">
                We retain your account, activity, and route data for as long as your
                account is active. You may request deletion of your account and
                associated data at any time by contacting us at the email below; we will
                also revoke any connected OAuth tokens on request.
            </p>

            <h2 className="text-xl font-semibold mt-8 mb-2">Data Security</h2>
            <p className="mb-6">
                We take reasonable technical and organizational measures to protect your
                data, including encrypted connections (HTTPS) and access controls on our
                database and infrastructure. No method of storage or transmission is
                completely secure, and we cannot guarantee absolute security.
            </p>

            <h2 className="text-xl font-semibold mt-8 mb-2">Children's Privacy</h2>
            <p className="mb-6">
                StreetSweep is not directed to children under 13, and we do not knowingly
                collect personal information from children under 13.
            </p>

            <h2 className="text-xl font-semibold mt-8 mb-2">Changes to This Policy</h2>
            <p className="mb-6">
                We may update this policy from time to time. Material changes will be
                reflected by updating the "Last updated" date above.
            </p>

            <h2 className="text-xl font-semibold mt-8 mb-2">Contact Us</h2>
            <p className="mb-6">
                Questions about this policy or your data? Contact us at{' '}
                <a href="mailto:chadbeaudin@gmail.com" className="text-blue-600 underline">
                    chadbeaudin@gmail.com
                </a>.
            </p>
        </main>
    );
}
