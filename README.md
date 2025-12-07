# Daniel's Space 🚀

A modern documentation and blog site built with [Nextra](https://nextra.site/) and [Next.js](https://nextjs.org/), featuring technical articles, insights, and thoughts on software development, cloud architecture, and emerging technologies.

![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-16.x-black)
![Nextra](https://img.shields.io/badge/Nextra-4.x-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)

## ✨ Features

- **📚 Documentation Site**: Comprehensive technical documentation organized by topics
- **📝 Blog**: Technical articles and insights on software development
- **🔍 Full-Text Search**: Powered by Pagefind for fast, client-side search
- **🌙 Dark Mode**: Built-in dark/light theme support
- **📱 Responsive Design**: Mobile-first design that works on all devices
- **⚡ Fast Performance**: Static site generation with excellent Core Web Vitals
- **🎨 Modern UI**: Clean, professional design with Tailwind CSS
- **📊 SEO Optimized**: Built-in SEO support with meta tags and structured data

## 🏗️ Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) with App Router
- **Documentation**: [Nextra](https://nextra.site/) with Docs Theme
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Search**: [Pagefind](https://pagefind.app/) for static site search
- **Package Manager**: [pnpm](https://pnpm.io/)
- **Code Quality**: Prettier, Husky, lint-staged

## 📁 Project Structure

```
daniel-space/
├── app/                    # Next.js App Router pages
│   ├── blogs/             # Blog posts and articles
│   ├── docs/              # Documentation sections
│   │   ├── aws_saa/       # AWS Solutions Architect content
│   │   ├── engineering/   # Software engineering practices
│   │   ├── java/          # Java-related content
│   │   ├── nodejs/        # Node.js guides and tutorials
│   │   └── kafka/         # Apache Kafka documentation
│   ├── project/           # Project showcases
│   ├── tags/              # Tag-based content organization
│   ├── globals.css        # Global styles
│   └── layout.tsx         # Root layout component
├── components/            # Reusable React components
├── public/                # Static assets
├── next.config.ts         # Next.js configuration
├── tailwind.config.ts     # Tailwind CSS configuration
└── tsconfig.json          # TypeScript configuration
```

## 🚀 Getting Started

### Prerequisites

- **Node.js**: Version 18 or higher
- **pnpm**: Version 8 or higher (recommended) or npm

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/nkcoder/daniel-space.git
   cd daniel-space
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Start the development server**

   ```bash
   pnpm dev
   ```

4. **Open your browser**
   Navigate to [http://localhost:3000](http://localhost:3000) to see the site.

### Available Scripts

```bash
# Run the local server
auto/run

// Update dependencies based on pnpm-lock.yaml
auto/update-dep

// If you want to upgrade dependencies to latest versions
pnpm update --latest
```

## 📖 Content Management

### Adding Blog Posts

1. Create a new folder in `app/blogs/` with your post slug
2. Add a `page.mdx` file with frontmatter:

   ```mdx
   ---
   title: Your Post Title
   description: Brief description of your post
   date: 2025-01-01
   ---

   # Your Content Here
   ```

3. Update `app/blogs/_meta.ts` to include your new post

### Adding Documentation

1. Create a new folder in the appropriate `app/docs/` section
2. Add a `page.mdx` file with your content
3. Update the corresponding `_meta.ts` file

### Organizing Content

- Use `_meta.ts` files to define navigation structure
- Frontmatter in MDX files controls page metadata
- Organize related content in logical folder structures

## 🔍 Search Functionality

The site includes full-text search powered by Pagefind:

- Automatically indexes all content during build
- Client-side search for fast results
- No server required for search functionality

## 🎨 Customization

### Styling

- Modify `tailwind.config.ts` for design system changes
- Update `app/globals.css` for global styles
- Create component-specific styles in `components/`

### Configuration

- Edit `next.config.ts` for Next.js settings
- Modify `app/layout.tsx` for site-wide layout changes
- Update metadata in individual pages as needed

## 🚀 Deployment

The site is optimized for static deployment on platforms like:

- **Vercel** (recommended): Deploy with zero configuration
- **Netlify**: Automatic builds from Git
- **GitHub Pages**: Static site hosting
- **Any static hosting provider**

### Build for Production

```bash
pnpm build
```

This generates a static build in the `.next` folder ready for deployment.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Nextra](https://nextra.site/) - Static Site Generator for Next.js
- Powered by [Next.js](https://nextjs.org/) - The React Framework
- Styled with [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework
- Search by [Pagefind](https://pagefind.app/) - Static site search

---

**Daniel's Space** - Sharing knowledge, one post at a time ❤️
