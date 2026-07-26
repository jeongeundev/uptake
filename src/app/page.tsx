import CatalogBindingsWizard from "@/components/catalog-bindings-wizard";
import AuthoringWizard from "@/components/authoring-wizard";

export default function Home() {
  return (
    <>
      <nav className="mx-auto flex max-w-5xl gap-4 px-6 pt-6 text-sm text-neutral-400">
        <a className="hover:text-neutral-200" href="#authoring">
          카탈로그 저작
        </a>
        <a className="hover:text-neutral-200" href="#instantiation">
          패턴 이식
        </a>
      </nav>
      <section id="authoring">
        <AuthoringWizard />
      </section>
      <section className="border-t border-neutral-800" id="instantiation">
        <CatalogBindingsWizard />
      </section>
    </>
  );
}
