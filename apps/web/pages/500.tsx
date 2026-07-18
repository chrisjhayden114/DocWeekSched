import { BrandedErrorPage } from "../components/BrandedErrorPage";

export default function Custom500() {
  return (
    <BrandedErrorPage
      statusCode={500}
      title="Something went wrong"
      message="We’re having trouble loading this page. Try again in a moment, or return to your event."
    />
  );
}
