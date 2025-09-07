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
  /** The hostname this stack serves (apex or subdomain), e.g. "fortunasbet.com" or "testing.fortunasbet.com" */
  domainName: string;
  /** Hosted zone ID for the APEX zone (fortunasbet.com) */
  hostedZoneId: string;
  /** Label (e.g., "Prod", "Testing") */
  stage: string;
  /**
   * Optional: glob(s) for hashed-asset directories produced by your bundler.
   * Defaults assume Vite/Webpack: "assets/**".
   * Provide additional globs if your build emits hashed files elsewhere.
   */
  hashedDirs?: string[];
}

export class WebsiteStack extends Stack {
  public readonly siteBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: WebsiteStackProps) {
    super(scope, id, props);

    const { domainName, hostedZoneId, stage } = props;

    const apexDomain = getApexDomain(domainName); // e.g. "fortunasbet.com"
    const wwwDomain = `www.${domainName}`;
    const wildcardSub = `*.${domainName}`;
    const siteOutputPath = path.join(
      __dirname,
      "../../../FortunasBetWebsite/dist",
    );

    // Folders that typically contain hashed assets (Vite/Webpack)
    const hashedDirs = props.hashedDirs ?? ["assets/**"];

    // Always bind to APEX zone
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      `${fortunasBet}-HostedZone-${stage}`,
      { hostedZoneId, zoneName: apexDomain },
    );

    // Always mint a certificate (must be us-east-1 for CloudFront)
    const certificate: certmgr.ICertificate =
      new certmgr.DnsValidatedCertificate(
        this,
        `${fortunasBet}-AutoCert-${stage}`,
        {
          hostedZone,
          region: "us-east-1",
          domainName,
          subjectAlternativeNames: [wwwDomain, wildcardSub],
          validation: certmgr.CertificateValidation.fromDns(hostedZone),
        },
      );

    // Logging bucket
    const loggingBucket = new s3.Bucket(
      this,
      `${fortunasBet}-AccessLogsBucket-${stage}`,
      {
        bucketName: `${fortunasBet.toLowerCase()}-accesslogsbucket-${stage.toLowerCase()}`,
        removalPolicy: RemovalPolicy.RETAIN,
        encryption: s3.BucketEncryption.S3_MANAGED,
        accessControl: s3.BucketAccessControl.LOG_DELIVERY_WRITE,
      },
    );

    loggingBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
        actions: ["s3:PutObject"],
        resources: [`${loggingBucket.bucketArn}/*`],
      }),
    );

    // Site bucket (private)
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

    // OAC
    const originAccessControl = new cloudfront.S3OriginAccessControl(
      this,
      `${fortunasBet}-OAC-${stage}`,
      { description: `Origin Access Control for ${fortunasBet} ${stage}` },
    );

    // Cache policy
    const customCachePolicy = new cloudfront.CachePolicy(
      this,
      `${fortunasBet}-CustomCachePolicy-${stage}`,
      {
        cachePolicyName: `${fortunasBet}-CustomCachePolicy-${stage}`,
        defaultTtl: Duration.minutes(5),
        minTtl: Duration.seconds(0),
        maxTtl: Duration.minutes(10),
        enableAcceptEncodingGzip: true,
        enableAcceptEncodingBrotli: true,
      },
    );

    // CloudFront Distribution
    this.distribution = new cloudfront.Distribution(
      this,
      `${fortunasBet}-Distribution-${stage}`,
      {
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(
            this.siteBucket,
            { originAccessControl },
          ),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          cachePolicy: customCachePolicy,
          compress: true,
        },
        domainNames: [domainName, wwwDomain],
        certificate,
        defaultRootObject: "index.html",
        errorResponses: [
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: Duration.seconds(1),
          },
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: Duration.seconds(1),
          },
        ],
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        enableLogging: true,
        logBucket: loggingBucket,
        logFilePrefix: "cloudfront-access/",
        comment: `CloudFront Distribution for ${fortunasBet} ${stage}`,
      },
    );

    // Allow CF to read bucket via OAC
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

    // DNS A/AAAA for domain and www (always manage DNS)
    const baseId = `${fortunasBet}-Alias-${sanitize(domainName)}-${stage}`;
    new route53.ARecord(this, `${baseId}-A`, {
      zone: hostedZone,
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(
        new route53_targets.CloudFrontTarget(this.distribution),
      ),
      ttl: Duration.seconds(60),
    });
    new route53.AaaaRecord(this, `${baseId}-AAAA`, {
      zone: hostedZone,
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(
        new route53_targets.CloudFrontTarget(this.distribution),
      ),
      ttl: Duration.seconds(60),
    });

    const wwwId = `${fortunasBet}-Alias-${sanitize(wwwDomain)}-${stage}`;
    new route53.ARecord(this, `${wwwId}-A`, {
      zone: hostedZone,
      recordName: wwwDomain,
      target: route53.RecordTarget.fromAlias(
        new route53_targets.CloudFrontTarget(this.distribution),
      ),
      ttl: Duration.seconds(60),
    });
    new route53.AaaaRecord(this, `${wwwId}-AAAA`, {
      zone: hostedZone,
      recordName: wwwDomain,
      target: route53.RecordTarget.fromAlias(
        new route53_targets.CloudFrontTarget(this.distribution),
      ),
      ttl: Duration.seconds(60),
    });

    // === Deployments with hashed vs non-hashed rules ===
    //
    // We do 3 passes:
    //   1) HTML (short cache) — exclude all JS/CSS and static assets
    //   2) UNHASHED JS/CSS (short cache)
    //   3) HASHED assets (long cache, immutable): typical Vite/Webpack "assets/**" + common hashed filename patterns

    // 1) HTML — short cache
    new s3deploy.BucketDeployment(this, `${fortunasBet}-DeployHtml-${stage}`, {
      destinationBucket: this.siteBucket,
      sources: [s3deploy.Source.asset(siteOutputPath)],
      distribution: this.distribution,
      distributionPaths: ["/*"],
      cacheControl: [
        s3deploy.CacheControl.fromString("public, max-age=0, must-revalidate"),
      ],
      exclude: [
        "**/*.js",
        "**/*.css",
        "**/*.map",
        "**/*.png",
        "**/*.jpg",
        "**/*.jpeg",
        "**/*.svg",
        "**/*.gif",
        "**/*.webp",
        "**/*.ico",
        "**/*.woff",
        "**/*.woff2",
        "**/*.ttf",
        ...hashedDirs,
      ],
      include: ["index.html", "**/*.html"],
    });

    // 2) UNHASHED JS/CSS — short cache
    //    (We exclude the hashed patterns & hashed dirs so only plain names like bundle.js, app.css get short caching.)
    new s3deploy.BucketDeployment(
      this,
      `${fortunasBet}-DeployUnhashedApp-${stage}`,
      {
        destinationBucket: this.siteBucket,
        sources: [s3deploy.Source.asset(siteOutputPath)],
        distribution: this.distribution,
        distributionPaths: ["/*"],
        cacheControl: [
          s3deploy.CacheControl.fromString(
            "public, max-age=0, must-revalidate",
          ),
        ],
        include: ["**/*.js", "**/*.css"],
        exclude: [
          // exclude maps (handled with hashed bundle typically)
          "**/*.map",
          // exclude typical hashed dirs
          ...hashedDirs,
          // exclude common hashed name patterns (loose globs)
          // e.g. app.abc123.js, app-abc123.css, app.abc123def456.js, etc.
          "**/*.[a-fA-F0-9]*.js",
          "**/*.[a-fA-F0-9]*.css",
          "**/*-*.*.js",
          "**/*-*.*.css",
        ],
      },
    );

    // 3) HASHED assets — long cache
    new s3deploy.BucketDeployment(
      this,
      `${fortunasBet}-DeployHashed-${stage}`,
      {
        destinationBucket: this.siteBucket,
        sources: [s3deploy.Source.asset(siteOutputPath)],
        distribution: this.distribution,
        distributionPaths: ["/*"],
        cacheControl: [
          s3deploy.CacheControl.fromString(
            "public, max-age=31536000, immutable",
          ),
        ],
        include: [
          // typical bundler assets dir(s)
          ...hashedDirs,
          // common hashed filename patterns at root or nested
          "**/*.[a-fA-F0-9]*.js",
          "**/*.[a-fA-F0-9]*.css",
          "**/*-*.*.js",
          "**/*-*.*.css",
          // also long-cache fonts & images normally hashed by bundlers
          "**/*.png",
          "**/*.jpg",
          "**/*.jpeg",
          "**/*.svg",
          "**/*.gif",
          "**/*.webp",
          "**/*.ico",
          "**/*.woff",
          "**/*.woff2",
          "**/*.ttf",
          "**/*.map",
        ],
      },
    );
  }
}

/** e.g., "testing.fortunasbet.com" -> "fortunasbet.com" */
function getApexDomain(host: string): string {
  const parts = host.split(".");
  if (parts.length < 2) return host;
  return parts.slice(-2).join(".");
}

/** Safe id suffix from a hostname */
function sanitize(name: string): string {
  return name.replace(/\./g, "-");
}
