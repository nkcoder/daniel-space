import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Banner, Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'My space',
  description: 'Mostly about tech, but also about life'
}

const banner = (
  <Banner>
    <h1>Welcome to My Space</h1>
    <p>Mostly about tech, but also about life</p>
  </Banner>
)

const navbar = (
  <Navbar
    logo={<b>Nextra</b>}
    // ... Your additional navbar options
  />
)
const footer = <Footer>MIT {new Date().getFullYear()} © Nextra.</Footer>

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      // Not required, but good for SEO
      lang="en"
      // Required to be set
      dir="ltr"
      // Suggested by `next-themes` package https://github.com/pacocoursey/next-themes#with-app
      suppressHydrationWarning
    >
      <Head
      // ... Your additional head options
      >
        {/* Your additional tags should be passed as `children` of `<Head>` element */}
      </Head>
      <body>
        <Layout
          banner={banner}
          navbar={navbar}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/shuding/nextra/tree/main/docs"
          footer={footer}
          // ... Your additional layout options
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
