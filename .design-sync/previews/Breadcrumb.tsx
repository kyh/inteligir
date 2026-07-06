import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@repo/ui";
import { MoreHorizontal } from "lucide-react";

export function VaultPath() {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>Vault</BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>Projects</BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>Q3 Roadmap</BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Launch checklist</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function Collapsed() {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>Vault</BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem aria-label="More folders">
          <MoreHorizontal size={16} />
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>Daily notes</BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>2026-07-04.md</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function CustomSeparator() {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>Vault</BreadcrumbItem>
        <BreadcrumbSeparator>/</BreadcrumbSeparator>
        <BreadcrumbItem>Research</BreadcrumbItem>
        <BreadcrumbSeparator>/</BreadcrumbSeparator>
        <BreadcrumbItem>
          <BreadcrumbPage>Embeddings survey</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
