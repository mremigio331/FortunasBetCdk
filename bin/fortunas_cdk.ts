#!/opt/homebrew/opt/node/bin/node
import * as cdk from "aws-cdk-lib";
import { WebsiteStack } from "../lib/stacks/websiteStack";
import { CognitoStack } from "../lib/stacks/cognitoStack";
import { DatabaseStack } from "../lib/stacks/databaseStack";
import { ApiStack } from "../lib/stacks/apiStack";
import { ApiDnsStack } from "../lib/stacks/apiDnsStack";
import * as fs from "fs";
import * as path from "path";
import { fortunasBet } from "../lib/constants";

async function getEnvConfig() {
  // Use environment variables for config in CI/CD, fallback to file for local dev
  const isCICD =
    !!process.env.CICD ||
    !!process.env.CODEBUILD_BUILD_ID ||
    !!process.env.CODEPIPELINE_EXECUTION_ID ||
    !!process.env.CODEDEPLOY_DEPLOYMENT_ID ||
    !!process.env.USE_SECRETS_MANAGER;
  console.log(
    `[CDK ENV DETECT] CICD: ${process.env.CICD}, CODEBUILD_BUILD_ID: ${process.env.CODEBUILD_BUILD_ID}, CODEPIPELINE_EXECUTION_ID: ${process.env.CODEPIPELINE_EXECUTION_ID}, CODEDEPLOY_DEPLOYMENT_ID: ${process.env.CODEDEPLOY_DEPLOYMENT_ID}, USE_SECRETS_MANAGER: ${process.env.USE_SECRETS_MANAGER}, isCICD: ${isCICD}`,
  );
  if (isCICD) {
    // Expect a single environment variable CDK_ENV_CONFIG containing the JSON config
    if (!process.env.CDK_ENV_CONFIG) {
      throw new Error(
        "CDK_ENV_CONFIG environment variable not set in CI/CD environment",
      );
    }
    return JSON.parse(process.env.CDK_ENV_CONFIG);
  } else {
    // Local fallback
    const envFilePath = path.resolve(__dirname, "../cdk.env.json");
    console.log(`[CDK ENV DETECT] Using local env file: ${envFilePath}`);
    const envFileContent = fs.readFileSync(envFilePath, "utf-8");
    return JSON.parse(envFileContent);
  }
}

async function main() {
  const app = new cdk.App();
  const awsEnv = { region: "us-west-2" };
  const envConfig = await getEnvConfig();

  for (const stage of Object.keys(envConfig)) {
    const config = envConfig[stage];
    console.log(`[CDK ENV DETECT] Deploying stage: ${stage}`, config);

    const {
      hostedZoneId,
      websiteDomainName,
      apiDomainName,
      callbackUrls,
      wildcardCertificateArn,
      apiWildcardCertificateArn,
      escalationEmail,
      escalationNumber,
    } = config;

    const databaseStack = new DatabaseStack(
      app,
      `${fortunasBet}-DatabaseStack-${stage}`,
      {
        env: awsEnv,
        stage,
      },
    );

    const cognitoStack = new CognitoStack(
      app,
      `${fortunasBet}-CognitoStack-${stage}`,
      {
        env: awsEnv,
        stage,
        callbackUrls,
        userTable: databaseStack.table,
        escalationEmail,
        escalationNumber,
      },
    );

    new WebsiteStack(app, `${fortunasBet}-WebsiteStack-${stage}`, {
      env: awsEnv,
      domainName: websiteDomainName,
      hostedZoneId,
      stage,
    });

    const api = new ApiStack(app, `${fortunasBet}-ApiStack-${stage}`, {
      env: awsEnv,
      apiDomainName: apiDomainName,
      stage,
      userPool: cognitoStack.userPool,
      userPoolClient: cognitoStack.userPoolClient,
      userTable: databaseStack.table,
      escalationEmail: escalationEmail,
      escalationNumber: escalationNumber,
    });

    new ApiDnsStack(app, `${fortunasBet}-ApiDnsStack-${stage}`, {
      env: awsEnv,
      stage,
      rootDomainName: websiteDomainName,
      apiDomainName: apiDomainName,
      hostedZoneId: hostedZoneId,
      api: api.api,
      certificateArn: apiWildcardCertificateArn,
    });
  }
}

main();
