import NextHead from "next/head";

type HeadProps = {
  title: string;
  description: string;
  image: string;
  preloadImages?: string[];
};

export const Head = ({
  title,
  description,
  image,
  preloadImages = [],
}: HeadProps) => {
  return (
    <NextHead>
      {/* basic */}
      <title>{title}</title>
      <meta content={description} name="description" />
      <meta content="#000000" name="theme-color" />
      {/* opengraph */}
      <meta content={description} property="og:description" />
      <meta content={title} property="og:site_name" />
      <meta content="website" property="og:type" />
      <meta content="https://blog.inteligir.com" property="og:url" />
      <meta content={image} name="image" property="og:image" />
      <meta content={title} property="og:title" />
      {/* twitter */}
      <meta content="summary_large_image" property="twitter:card" />
      <meta content={title} property="twitter:title" />
      <meta content={description} property="twitter:description" />
      <meta content={image} property="twitter:image" />
      {/* preload iamges */}
      {preloadImages.map((pli) => (
        <link as="image" href={pli} key={pli} rel="preload" />
      ))}
    </NextHead>
  );
};
