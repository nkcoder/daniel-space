import { Metadata, Viewport } from 'next';
import { Layout, Navbar } from 'nextra-theme-docs';
import 'nextra-theme-docs/style.css';
import { getPageMap } from 'nextra/page-map';
import './globals.css';

export const metadata: Metadata = {
  title: "Daniel's Space - Tech & Life",
  description: 'A modern documentation site about technology, development, and life experiences',
  icons: {
    icon: '/favicon.ico'
  }
};

export const viewport: Viewport = {
  themeColor: '#3b82f6',
  width: 'device-width',
  initialScale: 1.0
};

const navbar = <Navbar logo={<span className="font-bold text-lg">Daniel's Space</span>} />;

// TODO: tailwind css is not working for footer, so disable it for now

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pageMap = await getPageMap();

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Layout
          navbar={navbar}
          pageMap={pageMap}
          // footer={footer}
          docsRepositoryBase="https://github.com/nkcoder/daniel-space/blob/main"
          feedback={{
            content: 'Question? Give us feedback →',
            link: 'https://github.com/nkcoder/daniel-space/issues/new'
          }}
          sidebar={{
            defaultMenuCollapseLevel: 2,
            toggleButton: true,
            autoCollapse: true
          }}
          toc={{
            backToTop: true,
            float: true
          }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
