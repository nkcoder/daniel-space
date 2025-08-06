import { Metadata, Viewport } from 'next';
import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import 'nextra-theme-docs/style.css';
import { getPageMap } from 'nextra/page-map';
import './globals.css';

export const metadata: Metadata = {
  title: "Daniel's Space - Tech & Life",
  description: 'A modern documentation site about technology, development, and life experiences',
  icons: {
    icon: '/favicon.ico',
  },
};

export const viewport: Viewport = {
  themeColor: '#3b82f6',
  width: 'device-width',
  initialScale: 1.0,
};

const navbar = <Navbar logo={<span className="font-bold text-lg">Daniel's Space</span>} />;

// TODO: tailwind css is not working
const footer = (
  <Footer>
    <div className="text-center text-red-500">
      <p className="text-xs text-red-600 dark:text-red-400 text-center">
        MIT {new Date().getFullYear()} © Daniel's Space. Built with ❤️ using Nextra.
      </p>
    </div>
  </Footer>
);

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pageMap = await getPageMap();

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Layout
          navbar={navbar}
          pageMap={pageMap}
          footer={footer}
          docsRepositoryBase="https://github.com/nkcoder/daniel-space/blob/main"
          feedback={{
            content: 'Question? Give us feedback →',
            link: 'https://github.com/nkcoder/daniel-space/issues/new'
          }}
          sidebar={{
            defaultMenuCollapseLevel: 1,
            toggleButton: true,
          }}
          toc={{
            backToTop: true,
          }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
