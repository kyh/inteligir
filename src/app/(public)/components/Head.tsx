import NextHead from "next/head";

type HeadProps = {
  title: string;
  description: string;
  image: string;
  preloadImages?: string[];
};

export default function Head({
  title,
  description,
  image,
  preloadImages = [],
}: HeadProps) {
  return (
    <NextHead>
      {/* basic */}
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="theme-color" content="#000000" />
      {/* opengraph */}
      <meta property="og:description" content={description} />
      <meta property="og:site_name" content={title} />
      <meta property="og:type" content="website" />
      <meta property="og:url" content="https://blog.neorepo.com" />
      <meta name="image" property="og:image" content={image} />
      <meta property="og:title" content={title} />
      {/* twitter */}
      <meta property="twitter:card" content="summary_large_image" />
      <meta property="twitter:title" content={title} />
      <meta property="twitter:description" content={description} />
      <meta property="twitter:image" content={image} />
      {/* preload iamges */}
      {preloadImages.map((pli) => (
        <link key={pli} rel="preload" as="image" href={pli} />
      ))}
    </NextHead>
  );
}
