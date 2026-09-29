export default [
  {
    files: [
      'scripts/audits/verify-published-agent-first-use.mjs',
      'scripts/benchmarks/aggregate-multiround-correctness.mjs',
      'tests/multiround-correctness-scoring.spec.mjs',
      'examples/domain-planner-starter/*.mjs',
      'tests/domain-planner-starter.spec.mjs',
    ],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-constant-condition': 'error',
      'no-unreachable': 'error',
      'no-unused-vars': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
]
