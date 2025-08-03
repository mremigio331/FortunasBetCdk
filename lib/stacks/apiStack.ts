import {
  Stack,
  StackProps,
  Duration,
  aws_logs as logs,
  aws_apigateway as apigw,
  aws_lambda as lambda,
  aws_cognito as cognito,
  aws_dynamodb as dynamodb,
  aws_kms as kms,
} from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as path from "path";
import { addApiMonitoring } from "../monitoring/apiMonitoring";
import { fortunasBet } from "../constants";

interface ApiStackProps extends StackProps {
  apiDomainName: string;
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  stage: string;
  userTable: dynamodb.ITable;
  escalationEmail: string;
  escalationNumber: string;
}

export class ApiStack extends Stack {
  public readonly api: apigw.LambdaRestApi;
  public readonly identityPool: cognito.CfnIdentityPool;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      apiDomainName,
      userPool,
      userPoolClient,
      userTable,
      stage,
      escalationEmail,
      escalationNumber,
    } = props;

    const apiGwLogsRole = new iam.Role(
      this,
      `${fortunasBet}-ApiGatewayCloudWatchRole-${stage}`,
      {
        assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
        inlinePolicies: {
          ApiGwCloudWatchLogsPolicy: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  "logs:CreateLogGroup",
                  "logs:CreateLogStream",
                  "logs:DescribeLogGroups",
                  "logs:DescribeLogStreams",
                  "logs:PutLogEvents",
                ],
                resources: ["*"],
              }),
            ],
          }),
        },
      },
    );

    new apigw.CfnAccount(this, `${fortunasBet}-ApiGatewayAccount-${stage}`, {
      cloudWatchRoleArn: apiGwLogsRole.roleArn,
    });

    const layer = new lambda.LayerVersion(
      this,
      `${fortunasBet}-ApiLayer-${stage}`,
      {
        code: lambda.Code.fromAsset(
          path.join(__dirname, "../../../FortunasBetLambdas/lambda_layer.zip"),
        ),
        compatibleRuntimes: [lambda.Runtime.PYTHON_3_11],
        description: `${fortunasBet}-ApiLayer-${stage}`,
      },
    );

    const applicationLogsLogGroup = new logs.LogGroup(
      this,
      `${fortunasBet}-ApplicationLogs-${stage}`,
      {
        logGroupName: `/aws/lambda/${fortunasBet}-ApiLambda-${stage}`,
        retention: logs.RetentionDays.INFINITE,
      },
    );

    const fortunasBetApi = new lambda.Function(
      this,
      `${fortunasBet}-ApiLambda-${stage}`,
      {
        functionName: `${fortunasBet}-ApiLambda-${stage}`,
        runtime: lambda.Runtime.PYTHON_3_11,
        handler: "app.handler",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "../../../FortunasBetLambdas"),
        ),
        timeout: Duration.seconds(30),
        memorySize: 1024,
        layers: [layer],
        logGroup: applicationLogsLogGroup,
        tracing: lambda.Tracing.ACTIVE,
        description: `${fortunasBet}-ApiLambda-${stage}`,
        environment: {
          TABLE_NAME: userTable.tableName,
          COGNITO_USER_POOL_ID: userPool.userPoolId,
          COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
          COGNITO_API_REDIRECT_URI: `https://${apiDomainName}/`,
          COGNITO_REGION: "us-west-2",
          COGNITO_DOMAIN:
            stage.toLowerCase() === "prod"
              ? "https://fortunasbet.auth.us-west-2.amazoncognito.com"
              : `https://fortunasbet-${stage.toLowerCase()}.auth.us-west-2.amazoncognito.com`,
          STAGE: stage.toLowerCase(),
          API_DOMAIN_NAME: apiDomainName,
        },
      },
    );

    fortunasBetApi.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["cloudwatch:PutMetricData"],
        resources: ["*"],
      }),
    );

    userTable.grantReadWriteData(fortunasBetApi);

    const accessLogGroup = new logs.LogGroup(
      this,
      `${fortunasBet}-ServiceLogs-${stage}`,
      {
        logGroupName: `/aws/apigateway/${fortunasBet}-ServiceLogs-${stage}`,
        retention: logs.RetentionDays.INFINITE,
      },
    );

    this.identityPool = new cognito.CfnIdentityPool(
      this,
      `${fortunasBet}-IdentityPool-${stage}`,
      {
        allowUnauthenticatedIdentities: false,
        cognitoIdentityProviders: [
          {
            clientId: userPoolClient.userPoolClientId,
            providerName: userPool.userPoolProviderName,
          },
        ],
      },
    );

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(
      this,
      `${fortunasBet}-ApiAuthorizer-${stage}`,
      {
        cognitoUserPools: [userPool],
        authorizerName: `${fortunasBet}-ApiAuthorizer-${stage}`,
        identitySource: "method.request.header.Authorization",
      },
    );

    this.api = new apigw.LambdaRestApi(
      this,
      `${fortunasBet}-LambdaRestApi-${stage}`,
      {
        handler: fortunasBetApi,
        restApiName: `${fortunasBet}-Api-${stage}`,
        proxy: false,
        defaultMethodOptions: {
          authorizationType: apigw.AuthorizationType.COGNITO,
          authorizer,
        },
        defaultCorsPreflightOptions: {
          allowOrigins:
            stage.toLowerCase() === "prod"
              ? ["https://fortunasbet.com"]
              : stage.toLowerCase() === "testing"
                ? ["https://testing.fortunasbet.com", "http://localhost:8080"]
                : ["http://localhost:8080"],
          allowMethods: apigw.Cors.ALL_METHODS,
          allowHeaders: ["authorization", "content-type"],
          allowCredentials: true,
        },
        deployOptions: {
          tracingEnabled: true,
          accessLogDestination: new apigw.LogGroupLogDestination(
            accessLogGroup,
          ),
          accessLogFormat: apigw.AccessLogFormat.custom(
            JSON.stringify({
              requestId: "$context.requestId",
              user_id: "$context.authorizer.claims.sub",
              email: "$context.authorizer.claims.email",
              name: "$context.authorizer.claims.name",
              resourcePath: "$context.path",
              httpMethod: "$context.httpMethod",
              ip: "$context.identity.sourceIp",
              status: "$context.status",
              errorMessage: "$context.error.message",
              errorResponseType: "$context.error.responseType",
              auth_raw: "$context.authorizer",
              xrayTraceId: "$context.xrayTraceId",
            }),
          ),
          loggingLevel: apigw.MethodLoggingLevel.INFO,
          dataTraceEnabled: true,
          description: `WorkoutTracer-ApiGateway-Deployment-${stage}`,
        },
      },
    );

    const docsResource = this.api.root.addResource("docs");
    docsResource.addMethod("GET", new apigw.LambdaIntegration(fortunasBetApi), {
      authorizationType: apigw.AuthorizationType.NONE,
    });

    // Allow unauthenticated access to /docs/{proxy+} (static assets)
    const docsProxyResource = docsResource.addResource("{proxy+}");
    docsProxyResource.addMethod(
      "ANY",
      new apigw.LambdaIntegration(fortunasBetApi),
      {
        authorizationType: apigw.AuthorizationType.NONE,
      },
    );

    const openapiResource = this.api.root.addResource("openapi.json");
    openapiResource.addMethod(
      "GET",
      new apigw.LambdaIntegration(fortunasBetApi),
      {
        authorizationType: apigw.AuthorizationType.NONE,
      },
    );

    const proxyResource = this.api.root.addResource("{proxy+}");
    proxyResource.addMethod(
      "ANY",
      new apigw.LambdaIntegration(fortunasBetApi),
      {
        authorizationType: apigw.AuthorizationType.COGNITO,
        authorizer,
      },
    );

    addApiMonitoring(this, this.api, stage, escalationEmail, escalationNumber);
  }
}
