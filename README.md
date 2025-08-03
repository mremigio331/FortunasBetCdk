# FortunasBets CDK Infrastructure

This package contains the AWS Cloud Development Kit (CDK) infrastructure code for the FortunasBets application. It defines and deploys all AWS resources including DynamoDB tables, Lambda functions, API Gateway, Cognito user pools, CloudFront distributions, and S3 buckets.

## 🏗️ Architecture Overview

The CDK defines a complete serverless architecture:

- **DynamoDB**: Single-table design for rooms, memberships, and user data
- **Lambda Functions**: API endpoints and background processing
- **API Gateway**: RESTful API with Cognito authentication
- **Cognito**: User authentication and authorization
- **CloudFront + S3**: Static website hosting with CDN
- **Route 53**: DNS management for custom domains

## 📋 Prerequisites

- Node.js 18+ and npm
- AWS CLI configured with appropriate permissions
- AWS CDK CLI installed globally: `npm install -g aws-cdk`
- TypeScript knowledge for stack modifications

## 🚀 Getting Started

### Installation

```bash
npm install
```

### Build the project

```bash
npm run build
```

### Deploy to Development Environment

```bash
# Bootstrap CDK (first time only)
cdk bootstrap

# Deploy all stacks
cdk deploy --all

# Deploy specific stack
cdk deploy FortunasBets-UserPoolStack-Dev
```

### Deploy to Production Environment

```bash
# Set environment context
cdk deploy --all --context env=prod

# Or deploy specific production stacks
cdk deploy FortunasBets-UserPoolStack-Prod
```

## 🛠️ Available CDK Commands

### Development Workflow

```bash
# Watch for changes and recompile
npm run watch

# Run tests
npm run test

# Format code
npm run format
```

### CDK Commands

```bash
# Show all stacks
cdk list

# Show differences between deployed and current
cdk diff

# Synthesize CloudFormation templates
cdk synth

# Deploy all stacks
cdk deploy --all

# Deploy specific stack
cdk deploy <stack-name>

# Destroy stacks (careful!)
cdk destroy --all
```

### Useful CDK Options

```bash
# Deploy with approval for security changes
cdk deploy --require-approval never

# Deploy with specific AWS profile
cdk deploy --profile my-aws-profile

# Deploy with parameters
cdk deploy --parameters param1=value1
```

## 📁 Project Structure

```
lib/
├── constructs/           # Reusable CDK constructs
├── stacks/              # CDK stack definitions
│   ├── user-pool-stack.ts
│   ├── network-stack.ts
│   ├── database-stack.ts
│   ├── lambda-stack.ts
│   ├── api-stack.ts
│   └── website-stack.ts
├── utils/               # Helper utilities
└── app.ts              # Main CDK app entry point

bin/
└── fortunas_cdk.js     # CDK app executable

test/                   # Unit tests for stacks
```

## 🏷️ Stack Organization

### Core Infrastructure

- **NetworkStack**: VPC, subnets, security groups
- **DatabaseStack**: DynamoDB tables and indexes
- **UserPoolStack**: Cognito user pools and clients

### Application Layer

- **LambdaStack**: Function definitions and layers
- **ApiStack**: API Gateway and routing
- **WebsiteStack**: S3 bucket and CloudFront distribution

## 🔧 Configuration

### Environment Context

The CDK uses context values for environment-specific configuration:

```json
{
  "dev": {
    "domainName": "testing.fortunasbet.com",
    "certificateArn": "arn:aws:acm:..."
  },
  "prod": {
    "domainName": "fortunasbet.com",
    "certificateArn": "arn:aws:acm:..."
  }
}
```

### Stack Tags

All resources are automatically tagged with:

- `Environment`: dev/prod
- `Project`: FortunasBets
- `ManagedBy`: CDK

## 🚨 Important Notes

### Security Considerations

- All Lambda functions use least-privilege IAM roles
- API Gateway integrates with Cognito for authentication
- S3 buckets have public read blocked by default
- DynamoDB uses encryption at rest

### Monitoring

- CloudWatch logs for all Lambda functions
- API Gateway access logging enabled
- CloudWatch alarms for critical metrics

## 🐛 Troubleshooting

### Debugging

```bash
# Verbose output
cdk deploy --verbose

# Debug mode
cdk deploy --debug

# Check CloudFormation events
aws cloudformation describe-stack-events --stack-name <stack-name>
```
