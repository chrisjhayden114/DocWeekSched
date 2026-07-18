import type { NextPageContext } from "next";
import { BrandedErrorPage } from "../components/BrandedErrorPage";

function ErrorPage({ statusCode }: { statusCode?: number }) {
  if (statusCode === 404) {
    return (
      <BrandedErrorPage
        statusCode={404}
        title="Page not found"
        message="That link doesn’t match anything in this event app. Head back to your event to keep going."
      />
    );
  }
  return (
    <BrandedErrorPage
      statusCode={500}
      title="Something went wrong"
      message="We’re having trouble loading this page. Try again in a moment, or return to your event."
    />
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default ErrorPage;
