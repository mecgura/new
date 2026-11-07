import Script from "next/script";

/**
 * Google Analytics 4 and Meta Pixel for the PUBLIC site only. Each loads only when its id is set in the environment
 * (NEXT_PUBLIC_GA_ID = G-XXXXXXXXXX, NEXT_PUBLIC_META_PIXEL_ID = digits), so nothing third-party runs until you choose.
 */
const GA = /^G-[A-Z0-9]{6,14}$/.test(process.env.NEXT_PUBLIC_GA_ID ?? "") ? process.env.NEXT_PUBLIC_GA_ID! : "";
const PIXEL = /^\d{8,20}$/.test(process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "") ? process.env.NEXT_PUBLIC_META_PIXEL_ID! : "";

export function SiteAnalytics() {
  if (!GA && !PIXEL) return null;
  return (
    <>
      {GA ? (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA}`} strategy="afterInteractive" />
          <Script id="ga4" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config','${GA}',{anonymize_ip:true});`}</Script>
        </>
      ) : null}
      {PIXEL ? (
        <Script id="meta-pixel" strategy="afterInteractive">{`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${PIXEL}');fbq('track','PageView');`}</Script>
      ) : null}
    </>
  );
}
