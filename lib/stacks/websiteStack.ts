import { Stack, StackProps, RemovalPolicy, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53_targets from "aws-cdk-lib/aws-route53-targets";
import * as certmgr from "aws-cdk-lib/aws-certificatemanager";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as path from "path";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import { fortunasBet } from "../constants";

interface WebsiteStackProps extends StackProps {
  domainName: string;
  hostedZoneId: string;
  stage: string;
  certificateArn: string;
}

export class WebsiteStack extends Stack {
  public readonly siteBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: WebsiteStackProps) {
    super(scope, id, props);

    const { domainName, hostedZoneId, stage, certificateArn } = props;

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      `${fortunasBet}-HostedZone-${stage}`,
      {
        hostedZoneId,
        zoneName: domainName,
      },
    );

    // Import the shared certificate from us-east-1
    const certificate = certmgr.Certificate.fromCertificateArn(
      this,
      `${fortunasBet}-Certificate-${stage}`,
      certificateArn,
    );

    const loggingBucket = new s3.Bucket(
      this,
      `${fortunasBet}-AccessLogsBucket-${stage}`,
      {
        removalPolicy: RemovalPolicy.RETAIN,
        encryption: s3.BucketEncryption.S3_MANAGED,
        accessControl: s3.BucketAccessControl.LOG_DELIVERY_WRITE,
      },
    );

    this.siteBucket = new s3.Bucket(
      this,
      `${fortunasBet}-WebsiteBucket-${stage}`,
      {
        bucketName: `${fortunasBet.toLowerCase()}-website-bucket-${stage.toLowerCase()}`,
        publicReadAccess: false,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        serverAccessLogsBucket: loggingBucket,
        serverAccessLogsPrefix: "s3-access/",
      },
    );

    const originAccessControl = new cloudfront.S3OriginAccessControl(
      this,
      `${fortunasBet}-OAC-${stage}`,
      {
        description: `Origin Access Control for ${fortunasBet} ${stage}`,
      },
    );

    this.distribution = new cloudfront.Distribution(
      this,
      `${fortunasBet}-Distribution-${stage}`,
      {
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(
            this.siteBucket,
            {
              originAccessControl,
            },
          ),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          compress: true,
        },
        domainNames: [domainName],
        certificate: certificate,
        defaultRootObject: "index.html",
        errorResponses: [
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: Duration.minutes(5),
          },
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: Duration.minutes(5),
          },
        ],
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        enableLogging: true,
        logBucket: loggingBucket,
        logFilePrefix: "cloudfront-access/",
        comment: `CloudFront Distribution for FortunasBets ${stage}`,
      },
    );

    // Grant CloudFront access to the S3 bucket
    this.siteBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
        actions: ["s3:GetObject"],
        resources: [`${this.siteBucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            "AWS:SourceArn": `arn:aws:cloudfront::${this.account}:distribution/${this.distribution.distributionId}`,
          },
        },
      }),
    );

    // Create Route 53 alias record
    new route53.ARecord(this, `${fortunasBet}-AliasRecord-${stage}`, {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(
        new route53_targets.CloudFrontTarget(this.distribution),
      ),
    });

    // Deploy website content to S3 bucket
    new s3deploy.BucketDeployment(
      this,
      `${fortunasBet}-WebsiteDeployment-${stage}`,
      {
        sources: [
          s3deploy.Source.asset(
            path.join(__dirname, "../../../FortunasBetWebsite/dist"),
          ),
        ],
        destinationBucket: this.siteBucket,
        distribution: this.distribution,
        distributionPaths: ["/*"],
      },
    );
  }
}
