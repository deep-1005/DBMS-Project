export const metadata = {
  title: 'CTFVault',
  description: 'CTF challenge knowledge and semantic retrieval',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
