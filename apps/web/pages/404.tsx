import { BrandedErrorPage } from "../components/BrandedErrorPage";

export default function Custom404() {
  return (
    <BrandedErrorPage
      statusCode={404}
      title="Page not found"
      message="That link doesn’t match anything in this event app. Head back to your event to keep going."
    />
  );
}
