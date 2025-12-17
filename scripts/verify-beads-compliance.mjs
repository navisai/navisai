#!/usr/bin/env node

/**
 * Beads Documentation Compliance Verification Script
 *
 * Ensures all Beads issues reference governing documentation.
 * Docs are the canonical authority - all work must reference them.
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

// Mapping of label domains to required documentation
const DOMAIN_DOC_MAPPING = {
  // Network & Infrastructure
  'networking': ['docs/NETWORKING.md'],
  'bridge': ['docs/NETWORKING.md'],
  'mdns': ['docs/NETWORKING.md'],
  'packet-forwarding': ['docs/NETWORKING.md'],

  // API & IPC
  'api': ['docs/IPC_TRANSPORT.md', 'packages/api-contracts'],
  'websocket': ['docs/IPC_TRANSPORT.md'],
  'cors': ['docs/IPC_TRANSPORT.md'],
  'endpoints': ['docs/IPC_TRANSPORT.md', 'packages/api-contracts'],

  // Security & Auth
  'security': ['docs/SECURITY.md'],
  'auth': ['docs/SECURITY.md', 'docs/AUTH_MODEL.md'],
  'pairing': ['docs/PAIRING_PROTOCOL.md', 'docs/AUTH_MODEL.md'],

  // Setup & UX
  'setup': ['docs/SETUP.md', 'docs/ONBOARDING_FLOW.md'],
  'onboarding': ['docs/ONBOARDING_FLOW.md'],
  'cli': ['docs/CLI_WORKFLOW.md'],
  'pwa': ['docs/NETWORKING.md'], // PWA routing falls under networking

  // Core & Architecture
  'database': ['docs/SECURITY.md'], // Database security considerations
  'logging': ['docs/LOGGING.md'],
  'discovery': ['docs/DISCOVERY.md'],
  'core': ['docs/ARCHITECTURE.md']
};

/**
 * Check if a file exists in the repository
 */
function fileExists(path) {
  return existsSync(path);
}

/**
 * Get all Beads issues using the CLI
 */
function getBeadsIssues() {
  try {
    const output = execSync('bd list --format json', {
      encoding: 'utf8',
      cwd: process.cwd()
    });
    return JSON.parse(output);
  } catch (error) {
    console.error('❌ Failed to fetch Beads issues. Make sure `bd` is installed and you\'re in the navisai directory.');
    process.exit(1);
  }
}

/**
 * Extract documentation references from issue description
 */
function extractDocReferences(description) {
  if (!description) return [];

  // Match patterns like `docs/NETWORKING.md`, `docs/SECURITY.md`, etc.
  const docPattern = /docs\/[^\\\s\)]+\.md/g;
  const matches = description.match(docPattern) || [];

  // Match packages/api-contracts references
  const packagePattern = /packages\/api-contracts/g;
  const packageMatches = description.match(packagePattern) || [];

  return [...matches, ...packageMatches];
}

/**
 * Validate required documentation exists
 */
function validateDocumentationExists(docRefs) {
  const missing = [];
  for (const doc of docRefs) {
    if (!fileExists(doc)) {
      missing.push(doc);
    }
  }
  return missing;
}

/**
 * Get required documentation for a set of labels
 */
function getRequiredDocs(labels) {
  const required = new Set();

  for (const label of labels) {
    if (DOMAIN_DOC_MAPPING[label]) {
      DOMAIN_DOC_MAPPING[label].forEach(doc => required.add(doc));
    }
  }

  return Array.from(required);
}

/**
 * Check if an issue references any of the required documentation
 */
function hasRequiredDocReferences(docRefs, requiredDocs) {
  return requiredDocs.some(req =>
    docRefs.some(ref => ref.includes(req.replace('docs/', '').replace('.md', '')))
  );
}

/**
 * Main verification function
 */
function verifyBeadsCompliance() {
  console.log('🔍 Verifying Beads documentation compliance...\n');

  const issues = getBeadsIssues();
  let compliantCount = 0;
  let nonCompliantIssues = [];
  let issuesWithoutRequiredDocs = [];
  let missingDocs = [];

  for (const issue of issues) {
    const labels = issue.labels || [];
    const description = issue.description || '';
    const docRefs = extractDocReferences(description);
    const requiredDocs = getRequiredDocs(labels);

    // Check if any required documentation exists
    const existingRequiredDocs = requiredDocs.filter(doc => fileExists(doc));

    // Compliance checks
    const hasDocRefs = docRefs.length > 0;
    const hasRequiredRefs = existingRequiredDocs.length === 0 ||
                           hasRequiredDocReferences(docRefs, existingRequiredDocs);

    if (hasDocRefs && hasRequiredRefs) {
      compliantCount++;
    } else {
      nonCompliantIssues.push({
        id: issue.id,
        title: issue.title,
        labels,
        reason: !hasDocRefs ? 'No documentation references' :
                !hasRequiredRefs ? 'Missing required documentation references' :
                'Unknown compliance issue',
        docRefs,
        requiredDocs: existingRequiredDocs
      });

      if (!hasRequiredRefs && existingRequiredDocs.length > 0) {
        issuesWithoutRequiredDocs.push({
          id: issue.id,
          title: issue.title,
          requiredDocs: existingRequiredDocs,
          currentRefs: docRefs
        });
      }
    }

    // Check for missing documentation files
    const missingInRequired = validateDocumentationExists(requiredDocs);
    if (missingInRequired.length > 0) {
      missingDocs.push(...missingInRequired);
    }
  }

  // Results
  const totalIssues = issues.length;
  const complianceRate = ((compliantCount / totalIssues) * 100).toFixed(1);

  console.log(`📊 Compliance Results:`);
  console.log(`   ✅ Compliant issues: ${compliantCount}/${totalIssues} (${complianceRate}%)`);
  console.log(`   ❌ Non-compliant issues: ${nonCompliantIssues.length}\n`);

  if (nonCompliantIssues.length > 0) {
    console.log('🚨 Non-Compliant Issues:');
    console.log('========================\n');

    for (const issue of nonCompliantIssues) {
      console.log(`❌ ${issue.id}: ${issue.title}`);
      console.log(`   Labels: ${issue.labels.join(', ') || 'none'}`);
      console.log(`   Reason: ${issue.reason}`);
      if (issue.requiredDocs.length > 0) {
        console.log(`   Required docs: ${issue.requiredDocs.join(', ')}`);
      }
      if (issue.docRefs.length > 0) {
        console.log(`   Current refs: ${issue.docRefs.join(', ')}`);
      }
      console.log('');
    }

    // Provide fix commands
    console.log('🔧 Suggested Fixes:');
    console.log('==================\n');

    for (const issue of issuesWithoutRequiredDocs) {
      console.log(`# Fix ${issue.id}: ${issue.title}`);
      console.log(`bd update ${issue.id} --description "Existing description.

📋 Governing Documentation: ${issue.requiredDocs.map(doc => `\`${doc}\``).join(', ')}"`);
      console.log('');
    }
  }

  if (missingDocs.length > 0) {
    console.log('📄 Missing Documentation Files:');
    console.log('==============================\n');
    const uniqueMissing = [...new Set(missingDocs)];
    for (const doc of uniqueMissing) {
      console.log(`❌ ${doc} - referenced by labels but file doesn't exist`);
    }
    console.log('\n💡 Create missing docs or update issue labels to reference existing documentation.');
  }

  // Best practices
  console.log('\n📚 Documentation Reference Best Practices:');
  console.log('==========================================');
  console.log('1. Always reference canonical docs in issue descriptions');
  console.log('2. Use format: `docs/NETWORKING.md` for direct references');
  console.log('3. Include version numbers: `docs/NETWORKING.md v0.3`');
  console.log('4. Reference multiple docs when applicable');
  console.log('5. Update doc references when documentation changes\n');

  // Exit with error code if compliance is below 100%
  if (compliantCount < totalIssues) {
    console.log('❌ Beads documentation compliance check failed.');
    console.log(`   Required compliance: 100% (docs are canonical authority)`);
    console.log(`   Current compliance: ${complianceRate}%`);
    process.exit(1);
  }

  console.log('✅ All Beads issues properly reference governing documentation.');
  console.log('   Documentation confirmed as canonical authority.');
}

// Run verification
if (import.meta.url === `file://${process.argv[1]}`) {
  verifyBeadsCompliance();
}

export { verifyBeadsCompliance };